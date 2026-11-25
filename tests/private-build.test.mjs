import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { preparePrivatePosts, walkFiles } from "../scripts/private-posts.js";

test(
	"production output and a source-free CI rebuild publish multiple private articles without plaintext",
	{ timeout: 300_000 },
	async (t) => {
		const repository = fileURLToPath(new URL("../", import.meta.url));
		const cwd = mkdtempSync(path.join(os.tmpdir(), "blog-private-build-"));
		if (!process.env.KEEP_PRIVATE_BUILD_FIXTURE)
			t.after(() => rmSync(cwd, { recursive: true, force: true }));
		for (const name of [
			"src",
			"scripts",
			"public",
			"astro.config.mjs",
			"tsconfig.json",
			"tailwind.config.cjs",
			"postcss.config.mjs",
			"svelte.config.js",
			"package.json",
			"pagefind.yml",
		]) {
			cpSync(path.join(repository, name), path.join(cwd, name), {
				recursive: true,
				filter: (source) =>
					!source.startsWith(path.join(repository, "src/content/posts")),
			});
		}
		symlinkSync(
			path.join(repository, "node_modules"),
			path.join(cwd, "node_modules"),
			process.platform === "win32" ? "junction" : "dir",
		);
		const write = (filename, body) => {
			mkdirSync(path.dirname(path.join(cwd, filename)), { recursive: true });
			writeFileSync(path.join(cwd, filename), body);
		};
		const png = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6JMcAAAAASUVORK5CYII=",
			"base64",
		);
		write(
			"src/content/posts/public/index.md",
			"---\ntitle: Public fixture\npublished: 2026-11-24\nimage: cover.png\ncategory: Public\n---\nPublic fixture body.\n\n![public](cover.png)\n",
		);
		write("src/content/posts/public/cover.png", png);
		write(
			"src/content/posts/secret/index.md",
			"---\ntitle: PRIVATE_TITLE_SENTINEL\npublished: 2026-11-24\naccess: private\nupload: yes\ncategory: PRIVATE_CATEGORY_SENTINEL\ntags: [PRIVATE_TAG_SENTINEL]\n---\nPRIVATE_BODY_SENTINEL\n\n![private](private-image-sentinel.png)\n\n$x^2$\n\n```mermaid\ngraph LR; A-->B\n```\n",
		);
		write(
			"src/content/posts/secret/private-image-sentinel.png",
			Buffer.concat([png, Buffer.from("PRIVATE_IMAGE_SENTINEL")]),
		);
		for (const name of ["second.md", "topic/third.md"]) {
			write(
				`src/content/posts/secret/${name}`,
				`---\ntitle: PRIVATE_TITLE_SENTINEL ${name}\npublished: 2026-11-24\naccess: private\nupload: yes\n---\nPRIVATE_BODY_SENTINEL ${name}\n`,
			);
		}
		await preparePrivatePosts({
			cwd,
			password: "test-only-long-random-password-92741",
		});
		const state = JSON.parse(
			readFileSync(path.join(cwd, ".private-posts/state.json")),
		);
		const ids = Object.values(state).map((post) => post.id);
		assert.equal(ids.length, 3);
		const run = (args) => {
			const result = spawnSync(process.execPath, args, {
				cwd,
				encoding: "utf8",
				maxBuffer: 20 * 1024 * 1024,
				env: {
					...process.env,
					BLOG_PRIVATE_PASSWORD: "",
					NODE_ENV: "production",
				},
			});
			assert.ifError(result.error);
			assert.equal(result.status, 0, result.stdout + result.stderr);
		};
		const build = () => {
			run([path.join(repository, "node_modules/astro/astro.js"), "build"]);
			const pagefind = path.join(
				repository,
				"node_modules/pagefind/lib/runner/bin.cjs",
			);
			run([pagefind, "--site", "dist"]);
			const directoryPage = readFileSync(
				path.join(cwd, "dist/private/index.html"),
				"utf8",
			);
			for (const id of ids) {
				assert.match(directoryPage, new RegExp(`/private/${id}/`));
				const privatePage = readFileSync(
					path.join(cwd, `dist/private/${id}/index.html`),
					"utf8",
				);
				const envelope = JSON.parse(
					readFileSync(path.join(cwd, "encrypted-posts", `${id}.json`)),
				);
				assert.ok(privatePage.includes(envelope.ciphertext));
			}
			const publicPage = readFileSync(
				path.join(cwd, "dist/posts/public/index.html"),
				"utf8",
			);
			assert.match(publicPage, /Public fixture body/);
			for (const filename of walkFiles(path.join(cwd, "dist"))) {
				assert.doesNotMatch(filename, /private-image-sentinel|\/secret\//i);
				assert.doesNotMatch(
					readFileSync(path.join(cwd, "dist", filename)).toString("latin1"),
					/PRIVATE_(TITLE|BODY|IMAGE|CATEGORY|TAG)_SENTINEL|private-image-sentinel/,
				);
			}
		};
		build();
		// Simulate the public repository: no private sources, state or password.
		rmSync(path.join(cwd, "src/content/posts/secret"), { recursive: true });
		rmSync(path.join(cwd, ".private-posts"), { recursive: true });
		run(["scripts/private-posts.js"]);
		build();
		console.log(
			`Verified private build fixture: ${cwd}; articles: ${ids.length}`,
		);
	},
);
