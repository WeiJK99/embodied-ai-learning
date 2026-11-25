import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createUploadFilter, isPost, postsDirectory } from "./post-upload.js";
import {
	encryptedDirectory,
	privateBundles,
	scanPosts,
} from "./private-posts.js";

const implementationFiles = [
	"scripts/private-posts.js",
	"scripts/public-content-loader.js",
	"scripts/privacy-integration.js",
	"scripts/check-private-source.js",
	"scripts/init-privacy.js",
	".githooks",
	".github/workflows/deploy.yml",
	".gitignore",
	"astro.config.mjs",
	"src/utils/collection-posts.ts",
	"src/utils/encrypted-posts.ts",
	"src/utils/private-crypto.js",
	"src/utils/private-crypto.d.ts",
	"src/types/private-modules.d.ts",
	"src/pages/private",
	"src/pages/posts/[...slug].astro",
	"src/components/PrivateArticle.astro",
	"src/components/PostCard.astro",
	"src/components/PostPage.astro",
	"src/components/misc/ImageWrapper.astro",
	"src/scripts/mermaid.ts",
	"src/layouts/Layout.astro",
	"src/components/Navbar.astro",
	"src/styles",
	"src/config.ts",
	"scripts/publish-post.js",
	"scripts/post-upload.js",
	"scripts/new-post.js",
	"src/content/config.ts",
	"src/utils/content-utils.ts",
	"src/utils/post.ts",
	"package.json",
	"pnpm-lock.yaml",
	"frontmatter.json",
];

function run(cwd, command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd,
		stdio:
			options.input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
		shell: false,
		...options,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(
			result.stderr?.trim() ||
				`${command} failed (exit ${result.status ?? 1}).`,
		);
	}
	return result.stdout;
}

function git(cwd, args) {
	return run(cwd, "git", args, { stdio: "pipe", encoding: "utf8" });
}

function paths(output) {
	return output.split("\0").filter(Boolean);
}

function commitArticles(cwd, message, selected, withdrawn) {
	const temporaryRoot = path.resolve(os.tmpdir());
	const temporaryDirectory = mkdtempSync(
		path.join(temporaryRoot, "blog-publish-index-"),
	);
	const env = {
		...process.env,
		GIT_INDEX_FILE: path.join(temporaryDirectory, "index"),
	};
	if (path.dirname(temporaryDirectory) !== temporaryRoot) {
		throw new Error("Unexpected temporary index directory.");
	}
	try {
		// Prepare this commit independently of the user's existing staging area.
		run(cwd, "git", ["read-tree", "HEAD"], { env });
		if (selected.length) {
			run(
				cwd,
				"git",
				[
					"--literal-pathspecs",
					"add",
					"--pathspec-from-file=-",
					"--pathspec-file-nul",
				],
				{
					env,
					input: `${selected.join("\0")}\0`,
				},
			);
		}
		if (withdrawn.length) {
			// Remove only index entries; keep every local article and asset.
			run(cwd, "git", ["update-index", "--force-remove", "-z", "--stdin"], {
				env,
				input: `${withdrawn.join("\0")}\0`,
			});
		}
		run(cwd, "git", ["commit", "-m", message], { env });
		// Align just these staged paths with the commit. Keep working files and
		// unrelated staging; withdrawn files become local-only untracked files.
		run(
			cwd,
			"git",
			[
				"--literal-pathspecs",
				"reset",
				"-q",
				"HEAD",
				"--pathspec-from-file=-",
				"--pathspec-file-nul",
			],
			{
				input: `${[...selected, ...withdrawn].join("\0")}\0`,
			},
		);
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
}

function pushWithRetry(cwd, maxAttempts = 3) {
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		console.log(`Push attempt ${attempt}/${maxAttempts}...`);
		const result = spawnSync("git", ["push", "origin", "main"], {
			cwd,
			stdio: "inherit",
			shell: false,
		});
		if (result.status === 0) return;
		if (attempt < maxAttempts) {
			const delay = attempt * 5000;
			console.log(`Push failed. Retrying in ${delay / 1000} seconds...`);
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
		}
	}
	throw new Error(
		"Push failed after 3 attempts. The commit is safe locally; run pnpm publish-post again later.",
	);
}

function uploadFilter(cwd, filenames) {
	return createUploadFilter(
		filenames.filter(isPost).map((filename) => {
			let source;
			try {
				source = readFileSync(path.join(cwd, filename), "utf8");
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
				// Deleted articles retain the policy from their last commit.
				try {
					source = git(cwd, ["show", `:${filename}`]);
				} catch {
					source = git(cwd, ["show", `HEAD:${filename}`]);
				}
			}
			return { filename, source };
		}),
	);
}

function pendingCommits(cwd, canUpload) {
	const commits = git(cwd, ["rev-list", "origin/main..HEAD"])
		.trim()
		.split("\n")
		.filter(Boolean);
	for (const commit of commits) {
		const committedCanUpload = createUploadFilter(
			paths(
				git(cwd, [
					"ls-tree",
					"-r",
					"--name-only",
					"-z",
					commit,
					"--",
					postsDirectory,
				]),
			)
				.filter(isPost)
				.map((filename) => ({
					filename,
					source: git(cwd, ["show", `${commit}:${filename}`]),
				})),
		);
		const changed = paths(
			git(cwd, [
				"diff-tree",
				"--root",
				"-m",
				"--no-commit-id",
				"--no-renames",
				"--diff-filter=ACMRT",
				"--name-only",
				"-r",
				"-z",
				commit,
				"--",
				postsDirectory,
			]),
		);
		const blocked = changed.filter(
			(filename) => !canUpload(filename) || !committedCanUpload(filename),
		);
		if (blocked.length) {
			throw new Error(
				`Publish stopped: unpushed commit ${commit.slice(0, 7)} contains upload: no files or access: private source:\n${blocked.join("\n")}\nMove those files out of the unpushed commit before publishing.`,
			);
		}
	}
	return commits.length;
}

export function publishPost({
	cwd = process.cwd(),
	message = `content: publish article ${new Date().toISOString().slice(0, 10)}`,
	dryRun = false,
	prepare = () =>
		run(cwd, process.execPath, [
			fileURLToPath(new URL("./private-posts.js", import.meta.url)),
		]),
	build = () => {
		const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
		run(cwd, pnpm, ["build"], { shell: process.platform === "win32" });
	},
	push = () => pushWithRetry(cwd),
} = {}) {
	const branch = git(cwd, ["branch", "--show-current"]).trim();
	if (branch !== "main") {
		throw new Error(
			`Publish stopped: current branch is "${branch}", expected "main".`,
		);
	}
	const encrypted = privateBundles(cwd, scanPosts(cwd))
		.filter(
			(post) =>
				post.data.upload !== false &&
				post.data.upload !== "no" &&
				!post.data.draft,
		)
		.map((post) => post.filename);
	if (!dryRun) prepare();
	if (encrypted.length)
		console.log(
			`Encrypting private articles (plaintext excluded):\n${encrypted.join("\n")}`,
		);
	const tracked = paths(
		git(cwd, [
			"ls-tree",
			"-r",
			"--name-only",
			"-z",
			"HEAD",
			"--",
			postsDirectory,
			encryptedDirectory,
		]),
	);
	const filenames = [
		...new Set([
			...tracked,
			...paths(
				git(cwd, [
					"ls-files",
					"--cached",
					"--others",
					"--exclude-standard",
					"-z",
					"--",
					postsDirectory,
					encryptedDirectory,
				]),
			),
		]),
	];
	const canUpload = uploadFilter(cwd, filenames);
	const pending = pendingCommits(cwd, canUpload);
	const changed = [
		...new Set([
			...paths(
				git(cwd, [
					"diff",
					"--no-renames",
					"--name-only",
					"-z",
					"HEAD",
					"--",
					postsDirectory,
					encryptedDirectory,
				]),
			),
			...paths(
				git(cwd, [
					"ls-files",
					"--others",
					"--exclude-standard",
					"-z",
					"--",
					postsDirectory,
					encryptedDirectory,
				]),
			),
		]),
	];
	const selected = changed.filter(canUpload);
	const withdrawn = tracked.filter((filename) => !canUpload(filename));
	const skipped = changed.filter((filename) => !canUpload(filename));
	if (skipped.length) {
		console.log(
			`Skipping ${skipped.length} plaintext file(s) with upload: no or access: private:\n${skipped.join("\n")}\n`,
		);
	}
	if (withdrawn.length)
		console.log(
			`Withdrawing ${withdrawn.length} previously published file(s); local files will be kept:\n${withdrawn.join("\n")}\n`,
		);
	const implementation = [
		...new Set([
			...paths(
				git(cwd, [
					"diff",
					"--name-only",
					"-z",
					"HEAD",
					"--",
					...implementationFiles,
				]),
			),
			...paths(
				git(cwd, [
					"ls-files",
					"--others",
					"--exclude-standard",
					"-z",
					"--",
					...implementationFiles,
				]),
			),
		]),
	];
	const plan = {
		encrypted,
		upload: selected,
		withdraw: withdrawn,
		skipped,
		pending,
		implementation,
	};
	if (implementation.length) {
		const notice = `Publishing implementation changes are not committed:\n${implementation.join("\n")}\nCommit these code/config files first so GitHub Actions uses the same upload rules.`;
		if (!dryRun) throw new Error(notice);
		console.log(notice);
	}
	if (dryRun) {
		console.log(
			`Dry run: ${selected.length} file(s) to upload/update, ${withdrawn.length} file(s) to withdraw, ${pending} pending commit(s). No build, commit or push performed.`,
		);
		return plan;
	}
	if (selected.length || withdrawn.length) {
		console.log("\n[1/3] Building the production site...\n");
		build();
		console.log("\n[2/3] Committing article uploads and withdrawals...\n");
		commitArticles(cwd, message, selected, withdrawn);
		pendingCommits(cwd, canUpload);
	} else if (!pending) {
		console.log("No upload-enabled article changes or unpushed commits found.");
		return plan;
	} else {
		console.log(
			`No new upload-enabled article changes. Retrying ${pending} unpushed commit(s)...`,
		);
	}
	console.log("\n[3/3] Pushing to GitHub...\n");
	push();
	console.log(
		"\nPublished. GitHub Actions is now building and deploying the blog.",
	);
	return plan;
}

if (
	process.argv[1] &&
	fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
	const args = process.argv.slice(2);
	const dryRun = args.includes("--dry-run");
	const commitMessage = args
		.filter((arg) => arg !== "--dry-run")
		.join(" ")
		.trim();
	try {
		publishPost({
			dryRun,
			...(commitMessage ? { message: `content: ${commitMessage}` } : {}),
		});
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
