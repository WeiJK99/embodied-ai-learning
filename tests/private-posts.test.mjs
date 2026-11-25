import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkPrivateSource } from "../scripts/check-private-source.js";
import { createUploadFilter, postsDirectory } from "../scripts/post-upload.js";
import {
	encryptPayload,
	preparePrivatePosts,
	renderPrivatePost,
	scanPosts,
} from "../scripts/private-posts.js";
import { publishPost } from "../scripts/publish-post.js";
import { decryptPrivatePost } from "../src/utils/private-crypto.js";

const password = "test-only-long-random-password-92741";
const article = (extra = "", body = "PRIVATE_BODY_SENTINEL") =>
	`---\ntitle: PRIVATE_TITLE_SENTINEL\npublished: 2026-11-24\nupload: yes\naccess: private\n${extra}---\n${body}\n`;
function fixture(t) {
	const cwd = mkdtempSync(path.join(os.tmpdir(), "blog-private-test-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const write = (filename, body) => {
		mkdirSync(path.dirname(path.join(cwd, filename)), { recursive: true });
		writeFileSync(path.join(cwd, filename), body);
	};
	return { cwd, write };
}
function git(cwd, ...args) {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: "pipe",
	});
	assert.ifError(result.error);
	assert.equal(result.status, 0, result.stderr);
	return result.stdout.trim();
}

test("browser Web Crypto decrypts authentic ciphertext; wrong passwords and modified bytes fail", async () => {
	const payload = { title: "私人标题", html: "<p>私人正文</p>", assets: [] };
	const envelope = await encryptPayload(payload, password);
	assert.deepEqual(await decryptPrivatePost(envelope, password), payload);
	assert.doesNotMatch(JSON.stringify(envelope), /私人|password/);
	await assert.rejects(decryptPrivatePost(envelope, "incorrect-password"));
	const bytes = Buffer.from(envelope.ciphertext, "base64");
	bytes[0] ^= 1;
	await assert.rejects(
		decryptPrivatePost(
			{ ...envelope, ciphertext: bytes.toString("base64") },
			password,
		),
	);
	await assert.rejects(
		decryptPrivatePost({ ...envelope, iterations: 1 }, password),
	);
	const other = await encryptPayload(payload, password);
	assert.notEqual(other.salt, envelope.salt);
	assert.notEqual(other.iv, envelope.iv);
});

test("private Markdown, images and attachments are bundled into ciphertext, with stable updates and withdrawal", async (t) => {
	const { cwd, write } = fixture(t);
	const filename = `${postsDirectory}/secret/index.md`;
	write(
		filename,
		article(
			"",
			"![private](images/secret.png)\n\n[附件](notes.txt)\n\n<script>alert(1)</script>\n\n$x^2$\n\n$$\ny=x\n$$\n\n```mermaid\ngraph LR; A-->B\n```",
		),
	);
	write(`${postsDirectory}/secret/images/secret.png`, "PRIVATE_IMAGE_SENTINEL");
	write(`${postsDirectory}/secret/notes.txt`, "PRIVATE_ATTACHMENT_SENTINEL");
	await preparePrivatePosts({ cwd, password });
	const state = JSON.parse(
		readFileSync(path.join(cwd, ".private-posts/state.json")),
	);
	const output = path.join(
		cwd,
		"encrypted-posts",
		`${state[filename].id}.json`,
	);
	const contents = readFileSync(output, "utf8");
	assert.doesNotMatch(contents, /PRIVATE_|secret|notes/);
	const payload = await decryptPrivatePost(JSON.parse(contents), password);
	assert.equal(payload.title, "PRIVATE_TITLE_SENTINEL");
	assert.equal(
		Buffer.from(payload.assets[0].data, "base64").toString(),
		"PRIVATE_IMAGE_SENTINEL",
	);
	assert.equal(payload.assets.length, 2);
	assert.match(payload.html, /data-private-asset="0"/);
	assert.match(payload.html, /katex/);
	assert.match(payload.html, /mermaid-source/);
	assert.doesNotMatch(payload.html, /<script>/);
	await preparePrivatePosts({ cwd, password });
	assert.equal(readFileSync(output, "utf8"), contents);
	write(filename, article().replace("upload: yes", "upload: no"));
	await preparePrivatePosts({ cwd });
	assert.equal(existsSync(output), false);
	assert.equal(existsSync(path.join(cwd, filename)), true);
});

test("private export rejects short passwords, unsafe asset paths, external images and shared article directories", async (t) => {
	const { cwd, write } = fixture(t);
	const filename = `${postsDirectory}/secret/index.md`;
	write(filename, article());
	await assert.rejects(
		preparePrivatePosts({ cwd, password: "short" }),
		/16 characters/,
	);
	for (const body of [
		"![x](../public.png)",
		"![x](https://example.com/x.png)",
		"![x](/public.png)",
		"![[secret.png]]",
	]) {
		write(filename, article("", body));
		assert.throws(() => renderPrivatePost(cwd, scanPosts(cwd)[0]));
	}
	write(`${postsDirectory}/secret/another.md`, article());
	await assert.rejects(preparePrivatePosts({ cwd, password }), /own directory/);
});

test("private source and its complete asset directory are forbidden in Git, even when only an asset is staged", (t) => {
	const { cwd, write } = fixture(t);
	git(cwd, "init", "-b", "main");
	write(`${postsDirectory}/secret/index.md`, article());
	write(`${postsDirectory}/secret/image.png`, "private");
	const filter = createUploadFilter(scanPosts(cwd));
	assert.equal(filter(`${postsDirectory}/secret/image.png`), false);
	git(cwd, "add", "--", `${postsDirectory}/secret/image.png`);
	assert.throws(() => checkPrivateSource(cwd), /cannot be committed/);
});

test("publishing replaces tracked plaintext with ciphertext and preserves local originals and unrelated staging", async (t) => {
	const { cwd, write } = fixture(t);
	git(cwd, "init", "-b", "main");
	git(cwd, "config", "user.name", "Private Test");
	git(cwd, "config", "user.email", "private-test@example.invalid");
	git(cwd, "config", "core.hooksPath", path.join(cwd, "no-hooks"));
	git(cwd, "config", "commit.gpgSign", "false");
	const filename = `${postsDirectory}/secret/index.md`;
	write(filename, article().replace("access: private", "access: public"));
	write(`${postsDirectory}/secret/image.png`, "PRIVATE_IMAGE_SENTINEL");
	write("README.md", "original");
	git(cwd, "add", ".");
	git(cwd, "commit", "-m", "base");
	git(cwd, "update-ref", "refs/remotes/origin/main", "HEAD");
	write(filename, article("", "![image](image.png)"));
	write("README.md", "unrelated staged change");
	git(cwd, "add", "README.md");
	await preparePrivatePosts({ cwd, password });
	let pushes = 0;
	publishPost({
		cwd,
		prepare: () => {},
		build: () => {},
		push: () => pushes++,
	});
	assert.equal(pushes, 1);
	assert.equal(
		git(cwd, "ls-tree", "-r", "--name-only", "HEAD", "--", postsDirectory),
		"",
	);
	assert.match(
		git(cwd, "ls-tree", "-r", "--name-only", "HEAD", "--", "encrypted-posts"),
		/[a-f0-9]{32}\.json/,
	);
	assert.equal(git(cwd, "diff", "--cached", "--name-only"), "README.md");
	assert.equal(existsSync(path.join(cwd, filename)), true);
});
