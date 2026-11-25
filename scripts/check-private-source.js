import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createUploadFilter, isPost, postsDirectory } from "./post-upload.js";
import { scanPosts } from "./private-posts.js";

function git(cwd, args) {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: "pipe",
	});
	if (result.error || result.status !== 0)
		throw result.error || new Error(result.stderr);
	return result.stdout;
}

export function checkPrivateSource(cwd = process.cwd(), ref = undefined) {
	const files = (
		ref
			? git(cwd, ["ls-tree", "-r", "--name-only", "-z", ref])
			: git(cwd, ["ls-files", "-z"])
	)
		.split("\0")
		.filter(Boolean);
	const sourceRef = ref || "";
	const posts = files
		.filter(
			(filename) =>
				filename.startsWith(`${postsDirectory}/`) && isPost(filename),
		)
		.map((filename) => ({
			filename,
			source: git(cwd, ["show", `${sourceRef}:${filename}`]),
		}));
	const indexedCanUpload = createUploadFilter(posts);
	const localCanUpload = createUploadFilter(scanPosts(cwd));
	const canUpload = (filename) =>
		indexedCanUpload(filename) && localCanUpload(filename);
	const blocked = files.filter(
		(filename) =>
			(filename.startsWith(`${postsDirectory}/`) && !canUpload(filename)) ||
			/^(?:\.env\.private$|\.private-posts\/)/.test(filename),
	);
	if (blocked.length)
		throw new Error(
			`Private/local-only source cannot be committed or pushed:\n${blocked.join("\n")}\nUse pnpm publish-post to publish ciphertext and withdraw plaintext. Existing public Git history is not erased.`,
		);
}

export function checkPendingPrivateSource(cwd = process.cwd()) {
	// Check every unpushed version, so deleting plaintext in a later commit cannot
	// make an earlier private version safe to push. With no upstream, scan all.
	const upstream = spawnSync("git", ["rev-parse", "--verify", "origin/main"], {
		cwd,
		encoding: "utf8",
		stdio: "pipe",
	});
	const range = upstream.status === 0 ? "origin/main..HEAD" : "HEAD";
	const commits = git(cwd, ["rev-list", range])
		.trim()
		.split("\n")
		.filter(Boolean);
	for (const commit of commits) checkPrivateSource(cwd, commit);
	checkPrivateSource(cwd, "HEAD");
}

if (
	process.argv[1] &&
	fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
	try {
		if (process.argv.includes("--push")) checkPendingPrivateSource();
		else
			checkPrivateSource(
				process.cwd(),
				process.argv.includes("--head") ? "HEAD" : undefined,
			);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
