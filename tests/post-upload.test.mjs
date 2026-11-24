import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	createUploadFilter,
	postsDirectory,
	readUpload,
} from "../scripts/post-upload.js";
import { publishPost } from "../scripts/publish-post.js";

const article = (upload) =>
	`---\ntitle: Note\npublished: 2026-11-24\n${upload === undefined ? "" : `upload: ${upload}\n`}---\nBody\n`;
const postPath = (name) => `${postsDirectory}/${name}`;

test("upload supports yes/no and booleans, defaults to yes, and rejects invalid values", () => {
	for (const value of ["yes", "'yes'", "true", undefined]) {
		assert.equal(readUpload(article(value), "note.md"), true);
	}
	for (const value of ["no", "'no'", "false"]) {
		assert.equal(readUpload(article(value), "note.md"), false);
	}
	for (const value of ["maybe", "null", "[]", "{}"]) {
		assert.throws(
			() => readUpload(article(value), "note.md"),
			/note.md: upload must/,
		);
	}
	assert.equal(
		readUpload(`\uFEFF${article("no").replaceAll("\n", "\r\n")}`, "note.md"),
		false,
	);
});

test("only the top-level upload field in the opening frontmatter controls uploads", () => {
	assert.equal(readUpload("Body\n---\nupload: no\n---\n", "note.md"), true);
	assert.equal(
		readUpload("---\ndescription: |\n  upload: no\n---\n", "note.md"),
		true,
	);
	assert.equal(readUpload(`${article("yes")}\nupload: no\n`, "note.md"), true);
});

test("article attachments and ignored maintenance Markdown follow their owner's switch", () => {
	const canUpload = createUploadFilter([
		{ filename: postPath("private/index.md"), source: article("no") },
		{
			filename: postPath("private/images/_index.md"),
			source: "Image inventory",
		},
		{ filename: postPath("private/nested/index.mdx"), source: article("yes") },
		{ filename: postPath("public/中文.md"), source: article() },
		{ filename: postPath("flat.md"), source: article("no") },
	]);
	for (const name of [
		"private/index.md",
		"private/images/a.png",
		"private/images/_index.md",
		"flat.md",
	]) {
		assert.equal(canUpload(postPath(name)), false, name);
	}
	for (const name of [
		"private/nested/index.mdx",
		"private/nested/a.png",
		"public/中文.md",
		"public/a.png",
		"shared.png",
	]) {
		assert.equal(canUpload(postPath(name)), true, name);
	}
});

function git(cwd, ...args) {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		env: {
			...process.env,
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_CONFIG_GLOBAL: path.join(cwd, ".git-test-config"),
		},
	});
	assert.ifError(result.error);
	assert.equal(result.status, 0, result.stderr);
	return result.stdout.trim();
}

function fixture(t, files = {}) {
	const tempParent = path.resolve(os.tmpdir());
	const cwd = mkdtempSync(path.join(tempParent, "blog-upload-test-"));
	assert.ok(cwd.startsWith(path.join(tempParent, "blog-upload-test-")));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	writeFileSync(path.join(cwd, ".git-test-config"), "");
	git(cwd, "init", "-b", "main");
	git(cwd, "config", "user.name", "Upload Test");
	git(cwd, "config", "user.email", "upload-test@example.invalid");
	git(cwd, "config", "core.autocrlf", "false");
	git(cwd, "config", "core.hooksPath", path.join(cwd, "no-hooks"));
	git(cwd, "config", "commit.gpgSign", "false");
	const write = (filename, content) => {
		mkdirSync(path.dirname(path.join(cwd, filename)), { recursive: true });
		writeFileSync(path.join(cwd, filename), content);
	};
	write("README.md", "fixture");
	for (const [filename, content] of Object.entries(files))
		write(filename, content);
	git(cwd, "add", ".");
	git(cwd, "commit", "-m", "base");
	git(cwd, "update-ref", "refs/remotes/origin/main", "HEAD");
	return { cwd, write };
}

test("publishing commits eligible changes and deletions while preserving excluded staging", (t) => {
	const { cwd, write } = fixture(t, {
		[postPath("legacy.md")]: article(),
		[postPath("remove.md")]: article("yes"),
		[postPath("private-old/index.md")]: article("yes"),
		[postPath("private-old/a.png")]: "old private asset",
	});
	write(postPath("legacy.md"), `${article()}updated`);
	rmSync(path.join(cwd, postPath("remove.md")));
	write(postPath("private-old/index.md"), article("no"));
	write(postPath("private-old/a.png"), "changed private asset");
	write(postPath("public 中文/index.md"), article("yes"));
	write(postPath("public 中文/a.png"), "public asset");
	write(postPath("private/index.md"), article("no"));
	write(postPath("private/images/a.png"), "private asset");
	write(postPath("private/images/_index.md"), "private inventory");
	write("README.md", "unrelated staged change");
	git(cwd, "add", "--", "README.md", postPath("private"));
	const stagedBefore = git(
		cwd,
		"diff",
		"--cached",
		"--binary",
		"--",
		"README.md",
		postPath("private"),
	);
	let builds = 0;
	let pushes = 0;
	publishPost({ cwd, build: () => builds++, push: () => pushes++ });
	assert.equal(builds, 1);
	assert.equal(pushes, 1);
	assert.deepEqual(
		git(cwd, "diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "HEAD")
			.split("\0")
			.filter(Boolean)
			.sort(),
		[
			postPath("legacy.md"),
			postPath("private-old/a.png"),
			postPath("private-old/index.md"),
			postPath("public 中文/a.png"),
			postPath("public 中文/index.md"),
			postPath("remove.md"),
		].sort(),
	);
	assert.equal(
		git(
			cwd,
			"diff",
			"--cached",
			"--binary",
			"--",
			"README.md",
			postPath("private"),
		),
		stagedBefore,
	);
	assert.match(
		readFileSync(path.join(cwd, postPath("private/index.md")), "utf8"),
		/upload: no/,
	);
	assert.equal(
		readFileSync(path.join(cwd, postPath("private-old/a.png")), "utf8"),
		"changed private asset",
	);
	assert.match(
		readFileSync(path.join(cwd, postPath("private-old/index.md")), "utf8"),
		/upload: no/,
	);
});

test("only upload:no changes cause no build, commit or push, even if already staged", (t) => {
	const { cwd, write } = fixture(t);
	write(postPath("private/index.mdx"), article("false"));
	write(postPath("private/image.png"), "private");
	git(cwd, "add", "--", postsDirectory);
	const before = git(cwd, "status", "--porcelain");
	const head = git(cwd, "rev-parse", "HEAD");
	publishPost({
		cwd,
		build: () => assert.fail("must not build"),
		push: () => assert.fail("must not push"),
	});
	assert.equal(git(cwd, "rev-parse", "HEAD"), head);
	assert.equal(git(cwd, "status", "--porcelain"), before);
});

test("retry refuses an unpushed commit containing an excluded article or asset", (t) => {
	const { cwd, write } = fixture(t, {
		[postPath("private/index.md")]: article("no"),
	});
	write(postPath("private/image.png"), "private");
	git(cwd, "add", "--", postsDirectory);
	git(cwd, "commit", "-m", "manually committed private asset");
	assert.throws(
		() =>
			publishPost({
				cwd,
				build: () => assert.fail("must not build"),
				push: () => assert.fail("must not push"),
			}),
		/unpushed commit .* contains upload: no files/,
	);
});

test("retry pushes an eligible pending commit while leaving local-only files alone", (t) => {
	const { cwd, write } = fixture(t);
	write(postPath("public.md"), article("yes"));
	git(cwd, "add", "--", postsDirectory);
	git(cwd, "commit", "-m", "pending public note");
	write(postPath("private/index.md"), article("no"));
	let pushes = 0;
	publishPost({
		cwd,
		build: () => assert.fail("no new eligible changes"),
		push: () => pushes++,
	});
	assert.equal(pushes, 1);
	assert.match(git(cwd, "status", "--porcelain"), /private/);
});

test("deleting a local-only article in a later commit does not allow its earlier version to be pushed", (t) => {
	const { cwd, write } = fixture(t);
	write(postPath("private/index.md"), article("no"));
	write(postPath("private/image.png"), "private");
	git(cwd, "add", "--", postsDirectory);
	git(cwd, "commit", "-m", "private note committed manually");
	rmSync(path.join(cwd, postPath("private/index.md")));
	rmSync(path.join(cwd, postPath("private/image.png")));
	git(cwd, "add", "--", postsDirectory);
	git(cwd, "commit", "-m", "remove private note");
	assert.throws(
		() =>
			publishPost({
				cwd,
				build: () => assert.fail("must not build"),
				push: () => assert.fail("must not push"),
			}),
		/unpushed commit .* contains upload: no files/,
	);
});

test("switching an already published article to no withdraws it and its assets, retaining local edits", (t) => {
	const { cwd, write } = fixture(t, {
		[postPath("kinematics/index.md")]: article("yes"),
		[postPath("kinematics/image.png")]: "published image",
	});
	const localArticle = `${article("no")}local revisions`;
	write(postPath("kinematics/index.md"), localArticle);
	write(postPath("kinematics/image.png"), "local image");
	write("README.md", "unrelated staged change");
	git(cwd, "add", "--", "README.md", postPath("kinematics"));
	let pushes = 0;
	publishPost({ cwd, build: () => {}, push: () => pushes++ });
	assert.equal(pushes, 1);
	assert.equal(
		git(
			cwd,
			"ls-tree",
			"-r",
			"--name-only",
			"HEAD",
			"--",
			postPath("kinematics"),
		),
		"",
	);
	assert.equal(
		readFileSync(path.join(cwd, postPath("kinematics/index.md")), "utf8"),
		localArticle,
	);
	assert.equal(
		readFileSync(path.join(cwd, postPath("kinematics/image.png")), "utf8"),
		"local image",
	);
	assert.equal(git(cwd, "diff", "--cached", "--name-only"), "README.md");
	const withdrawnHead = git(cwd, "rev-parse", "HEAD");
	// Simulate a successful push, then publishing the unchanged local-only note.
	git(cwd, "update-ref", "refs/remotes/origin/main", "HEAD");
	publishPost({
		cwd,
		build: () => assert.fail("must not rebuild"),
		push: () => assert.fail("must not push"),
	});
	assert.equal(git(cwd, "rev-parse", "HEAD"), withdrawnHead);
	// yes must put the entire article bundle back into the next commit.
	write(postPath("kinematics/index.md"), article("yes"));
	publishPost({ cwd, build: () => {}, push: () => pushes++ });
	assert.equal(pushes, 2);
	assert.match(
		git(cwd, "show", `HEAD:${postPath("kinematics/index.md")}`),
		/upload: yes/,
	);
	assert.equal(
		git(cwd, "show", `HEAD:${postPath("kinematics/image.png")}`),
		"local image",
	);
});

test("a withdrawal-only pending commit can be retried without uploading the local files", (t) => {
	const { cwd, write } = fixture(t, {
		[postPath("old/index.md")]: article("yes"),
	});
	write(postPath("old/index.md"), article("no"));
	assert.throws(
		() =>
			publishPost({
				cwd,
				build: () => {},
				push: () => {
					throw new Error("simulated push failure");
				},
			}),
		/simulated push failure/,
	);
	const head = git(cwd, "rev-parse", "HEAD");
	let pushes = 0;
	publishPost({
		cwd,
		build: () => assert.fail("must not rebuild"),
		push: () => pushes++,
	});
	assert.equal(pushes, 1);
	assert.equal(git(cwd, "rev-parse", "HEAD"), head);
	assert.match(
		readFileSync(path.join(cwd, postPath("old/index.md")), "utf8"),
		/upload: no/,
	);
});

test("dry-run reports withdrawals without changing the repository or local articles", (t) => {
	const { cwd, write } = fixture(t, { [postPath("old.md")]: article("yes") });
	write(postPath("old.md"), article("no"));
	const head = git(cwd, "rev-parse", "HEAD");
	const status = git(cwd, "status", "--porcelain");
	const plan = publishPost({
		cwd,
		dryRun: true,
		build: () => assert.fail("must not build"),
		push: () => assert.fail("must not push"),
	});
	assert.deepEqual(plan.withdraw, [postPath("old.md")]);
	assert.deepEqual(plan.upload, []);
	assert.equal(git(cwd, "rev-parse", "HEAD"), head);
	assert.equal(git(cwd, "status", "--porcelain"), status);
});

test("publishing stops when the implementation would differ from the code built on GitHub", (t) => {
	const { cwd, write } = fixture(t, {
		"src/content/config.ts": "committed schema",
	});
	write("src/content/config.ts", "local schema");
	write(postPath("new.md"), article("yes"));
	assert.throws(
		() =>
			publishPost({
				cwd,
				build: () => assert.fail("must not build"),
				push: () => assert.fail("must not push"),
			}),
		/implementation changes are not committed/,
	);
	assert.equal(git(cwd, "rev-list", "--count", "HEAD"), "1");
});
