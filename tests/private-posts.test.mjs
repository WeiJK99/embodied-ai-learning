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

test("multiple private articles share a directory with independent ciphertext, updates and withdrawals", async (t) => {
	const { cwd, write } = fixture(t);
	const root = `${postsDirectory}/secret`;
	const filenames = [
		"first.md",
		"second.md",
		"third.md",
		"nested/index.md",
	].map((name) => `${root}/${name}`);
	for (const [index, filename] of filenames.entries()) {
		write(
			filename,
			article(
				"",
				`PRIVATE_BODY_${index}\n\n![shared](${index === 3 ? "nested.png" : "shared.png"})`,
			).replace("PRIVATE_TITLE_SENTINEL", `PRIVATE_TITLE_${index}`),
		);
	}
	write(`${root}/shared.png`, "PRIVATE_SHARED_IMAGE");
	write(`${root}/nested/nested.png`, "PRIVATE_NESTED_IMAGE");
	write(
		`${root}/local-only.md`,
		article().replace("upload: yes", "upload: no"),
	);
	write(`${root}/draft.md`, article("draft: true\n"));
	assert.deepEqual(
		(await preparePrivatePosts({ cwd, dryRun: true })).sort(),
		[...filenames].sort(),
	);
	await preparePrivatePosts({ cwd, password });
	const statePath = path.join(cwd, ".private-posts/state.json");
	const state = JSON.parse(readFileSync(statePath));
	assert.deepEqual(Object.keys(state).sort(), [...filenames].sort());
	assert.equal(new Set(Object.values(state).map((post) => post.id)).size, 4);
	const outputs = filenames.map((filename) =>
		path.join(cwd, "encrypted-posts", `${state[filename].id}.json`),
	);
	const contents = outputs.map((output) => readFileSync(output, "utf8"));
	for (const [index, contentsOfPost] of contents.entries()) {
		assert.doesNotMatch(contentsOfPost, /PRIVATE_/);
		const payload = await decryptPrivatePost(
			JSON.parse(contentsOfPost),
			password,
		);
		assert.equal(payload.title, `PRIVATE_TITLE_${index}`);
		assert.match(payload.html, new RegExp(`PRIVATE_BODY_${index}`));
		assert.equal(payload.assets.length, 1);
		assert.equal(
			Buffer.from(payload.assets[0].data, "base64").toString(),
			index === 3 ? "PRIVATE_NESTED_IMAGE" : "PRIVATE_SHARED_IMAGE",
		);
	}
	const canUpload = createUploadFilter(scanPosts(cwd));
	for (const filename of [
		...filenames,
		`${root}/shared.png`,
		`${root}/nested/nested.png`,
	])
		assert.equal(canUpload(filename), false, filename);
	write(filenames[0], article().replace("upload: yes", "upload: no"));
	write(filenames[1], article("", "PRIVATE_UPDATED_BODY"));
	rmSync(path.join(cwd, filenames[2]));
	await preparePrivatePosts({ cwd, password });
	const next = JSON.parse(readFileSync(statePath));
	assert.equal(existsSync(outputs[0]), false);
	assert.equal(existsSync(outputs[2]), false);
	assert.equal(existsSync(path.join(cwd, filenames[0])), true);
	assert.equal(next[filenames[1]].id, state[filenames[1]].id);
	assert.equal(next[filenames[3]].id, state[filenames[3]].id);
	assert.equal(readFileSync(outputs[3], "utf8"), contents[3]);
	assert.match(
		(await decryptPrivatePost(JSON.parse(readFileSync(outputs[1])), password))
			.html,
		/PRIVATE_UPDATED_BODY/,
	);
});

test("private export accepts eight-character passwords and rejects fewer than eight characters", async (t) => {
	const { cwd, write } = fixture(t);
	write(`${postsDirectory}/secret/index.md`, article());
	for (const shortPassword of ["", "1234567", "😀".repeat(7)]) {
		await assert.rejects(
			preparePrivatePosts({ cwd, password: shortPassword }),
			/at least 8 characters/,
		);
	}
	for (const validPassword of ["Abc123!?", "密".repeat(8)]) {
		await preparePrivatePosts({ cwd, password: validPassword });
		const state = JSON.parse(
			readFileSync(path.join(cwd, ".private-posts/state.json")),
		);
		const { id } = Object.values(state)[0];
		const envelope = JSON.parse(
			readFileSync(path.join(cwd, "encrypted-posts", `${id}.json`)),
		);
		assert.equal(
			(await decryptPrivatePost(envelope, validPassword)).title,
			"PRIVATE_TITLE_SENTINEL",
		);
	}
});

test("private export rejects short passwords, unsafe asset paths, external images and mixed public/private directories", async (t) => {
	const { cwd, write } = fixture(t);
	const filename = `${postsDirectory}/secret/index.md`;
	write(filename, article());
	await assert.rejects(
		preparePrivatePosts({ cwd, password: "short" }),
		/8 characters/,
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
	write(filename, article());
	for (const other of ["another.md", "nested/index.md"]) {
		write(
			`${postsDirectory}/secret/${other}`,
			article().replace("access: private", "access: public"),
		);
		await assert.rejects(
			preparePrivatePosts({ cwd, password }),
			/keep public posts outside private directories/,
		);
		rmSync(path.join(cwd, postsDirectory, "secret", other));
	}
	write(`${postsDirectory}/flat.md`, article());
	await assert.rejects(preparePrivatePosts({ cwd, password }), /subdirectory/);
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
	write(
		`${postsDirectory}/secret/second.md`,
		article("", "PRIVATE_SECOND_BODY"),
	);
	write(`${postsDirectory}/secret/third.md`, article("", "PRIVATE_THIRD_BODY"));
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
	const ciphertextFiles = git(
		cwd,
		"ls-tree",
		"-r",
		"--name-only",
		"HEAD",
		"--",
		"encrypted-posts",
	).split("\n");
	assert.equal(ciphertextFiles.length, 3);
	for (const output of ciphertextFiles)
		assert.match(output, /^encrypted-posts\/[a-f0-9]{32}\.json$/);
	assert.equal(git(cwd, "diff", "--cached", "--name-only"), "README.md");
	assert.equal(existsSync(path.join(cwd, filename)), true);
	assert.equal(
		existsSync(path.join(cwd, postsDirectory, "secret/second.md")),
		true,
	);
	assert.equal(
		existsSync(path.join(cwd, postsDirectory, "secret/third.md")),
		true,
	);
});
