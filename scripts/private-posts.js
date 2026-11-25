import { createHash, randomBytes, webcrypto } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import katex from "katex";
import MarkdownIt from "markdown-it";
import { isPost, postsDirectory, readPost, readUpload } from "./post-upload.js";

export const encryptedDirectory = "encrypted-posts";
export const iterations = 600_000;
const aad = new TextEncoder().encode("blog-private-post:v1");

// Refuse symlinks so an article bundle cannot accidentally include other files.
export function walkFiles(root, base = root) {
	if (!existsSync(root)) return [];
	return readdirSync(root, { withFileTypes: true }).flatMap((item) => {
		if (item.name.startsWith(".") || item.name === "node_modules") return [];
		const absolute = path.join(root, item.name);
		if (item.isSymbolicLink())
			throw new Error(`Symlinks are not supported: ${absolute}`);
		return item.isDirectory()
			? walkFiles(absolute, base)
			: [path.relative(base, absolute).replaceAll("\\", "/")];
	});
}

export function scanPosts(cwd) {
	return walkFiles(path.join(cwd, postsDirectory))
		.filter(isPost)
		.map((relative) => {
			const filename = `${postsDirectory}/${relative}`;
			const source = readFileSync(path.join(cwd, filename), "utf8");
			return { filename, source, ...readPost(source, filename) };
		});
}

export async function encryptPayload(payload, password) {
	const salt = randomBytes(16);
	const iv = randomBytes(12);
	const material = await webcrypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password),
		"PBKDF2",
		false,
		["deriveKey"],
	);
	const key = await webcrypto.subtle.deriveKey(
		{ name: "PBKDF2", hash: "SHA-256", salt, iterations },
		material,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt"],
	);
	const ciphertext = await webcrypto.subtle.encrypt(
		{ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
		key,
		new TextEncoder().encode(JSON.stringify(payload)),
	);
	return {
		version: 1,
		kdf: "PBKDF2-SHA256",
		iterations,
		salt: salt.toString("base64"),
		iv: iv.toString("base64"),
		ciphertext: Buffer.from(ciphertext).toString("base64"),
	};
}

export function renderPrivatePost(cwd, post) {
	if (!post.filename.endsWith(".md"))
		throw new Error(`${post.filename}: private posts support .md, not MDX.`);
	const directory = path.dirname(path.join(cwd, post.filename));
	const assets = [];
	const ids = new Map();
	const mime = {
		".png": "image/png",
		".jpg": "image/jpeg",
		".jpeg": "image/jpeg",
		".gif": "image/gif",
		".webp": "image/webp",
		".avif": "image/avif",
	};
	function asset(url, image) {
		if (/^(?:[a-z][\w+.-]*:|\/|#)/i.test(url)) {
			if (!image && /^(?:https?:|mailto:|#)/i.test(url)) return undefined;
			throw new Error(
				`${post.filename}: private assets must be relative files inside the article directory: ${url}`,
			);
		}
		const decoded = decodeURIComponent(url.split(/[?#]/)[0]);
		const absolute = path.resolve(directory, decoded);
		const relative = path.relative(directory, absolute);
		if (
			!relative ||
			relative.startsWith("..") ||
			path.isAbsolute(relative) ||
			realpathSync(absolute) !== absolute
		) {
			throw new Error(
				`${post.filename}: asset escapes its private article directory: ${url}`,
			);
		}
		const type = mime[path.extname(absolute).toLowerCase()];
		if (image && !type)
			throw new Error(
				`${post.filename}: use PNG/JPEG/GIF/WebP/AVIF for private images: ${url}`,
			);
		if (/\.(?:md|mdx|html?|svg|js|mjs)$/i.test(absolute))
			throw new Error(
				`${post.filename}: unsupported private attachment: ${url}`,
			);
		let id = ids.get(absolute);
		if (id === undefined) {
			id = String(assets.length);
			ids.set(absolute, id);
			assets.push({
				id,
				name: path.basename(absolute),
				type: type || "application/octet-stream",
				data: readFileSync(absolute).toString("base64"),
			});
		}
		return id;
	}
	const parser = new MarkdownIt({ html: false, linkify: true });
	parser.renderer.rules.image = (tokens, index) => {
		const token = tokens[index];
		const id = asset(token.attrGet("src") || "", true);
		return `<img data-private-asset="${id}" alt="${parser.utils.escapeHtml(token.content)}" loading="lazy">`;
	};
	const linkOpen = parser.renderer.rules.link_open;
	parser.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
		const token = tokens[index];
		const id = asset(token.attrGet("href") || "", false);
		if (id !== undefined) {
			token.attrSet("href", "#");
			token.attrSet("data-private-asset", id);
			token.attrSet("download", assets[Number(id)].name);
		} else token.attrSet("rel", "noopener noreferrer");
		return linkOpen
			? linkOpen(tokens, index, options, env, renderer)
			: renderer.renderToken(tokens, index, options);
	};
	const fence = parser.renderer.rules.fence;
	parser.renderer.rules.fence = (tokens, index, options, env, renderer) =>
		tokens[index].info.trim() === "mermaid"
			? `<pre class="mermaid-source"><code>${parser.utils.escapeHtml(tokens[index].content)}</code></pre>`
			: fence(tokens, index, options, env, renderer);
	parser.inline.ruler.before("escape", "private-math", (state, silent) => {
		if (state.src[state.pos] !== "$" || state.src[state.pos + 1] === "$")
			return false;
		const end = state.src.indexOf("$", state.pos + 1);
		if (end < 0 || state.src.slice(state.pos + 1, end).includes("\n"))
			return false;
		if (!silent) {
			const token = state.push("private_math", "", 0);
			token.content = state.src.slice(state.pos + 1, end);
		}
		state.pos = end + 1;
		return true;
	});
	parser.renderer.rules.private_math = (tokens, index) =>
		katex.renderToString(tokens[index].content, {
			throwOnError: false,
			trust: false,
		});
	parser.block.ruler.before(
		"fence",
		"private-math-block",
		(state, start, end, silent) => {
			const first = state.src
				.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start])
				.trim();
			if (!first.startsWith("$$")) return false;
			let last = start;
			let content = first.slice(2);
			if (content.endsWith("$$")) content = content.slice(0, -2);
			else {
				for (last = start + 1; last < end; last++) {
					const line = state.src.slice(state.bMarks[last], state.eMarks[last]);
					if (line.trim().endsWith("$$")) {
						content += `\n${line.slice(0, line.lastIndexOf("$$"))}`;
						break;
					}
					content += `\n${line}`;
				}
				if (last === end) return false;
			}
			if (!silent) {
				const token = state.push("private_math_block", "", 0);
				token.content = content;
			}
			state.line = last + 1;
			return true;
		},
	);
	parser.renderer.rules.private_math_block = (tokens, index) =>
		katex.renderToString(tokens[index].content, {
			displayMode: true,
			throwOnError: false,
			trust: false,
		});
	if (/!\[\[/.test(post.body))
		throw new Error(
			`${post.filename}: use standard Markdown images ![alt](images/file.png), rather than Obsidian embeds.`,
		);
	let html = "";
	if (post.data.image) html += parser.render(`![](${post.data.image})`);
	html += parser.render(post.body);
	return { title: String(post.data.title || "私密文章"), html, assets };
}

export function privateBundles(cwd, posts = scanPosts(cwd)) {
	return posts
		.filter((post) => post.data.access === "private")
		.map((post) => {
			const directory = path.posix.dirname(post.filename);
			if (
				directory === postsDirectory ||
				posts.some(
					(other) =>
						other !== post && other.filename.startsWith(`${directory}/`),
				)
			) {
				throw new Error(
					`${post.filename}: give each private post its own directory containing one index.md and its attachments.`,
				);
			}
			return { ...post, directory };
		});
}

export async function preparePrivatePosts({
	cwd = process.cwd(),
	password,
	dryRun = false,
} = {}) {
	const posts = scanPosts(cwd);
	const bundles = privateBundles(cwd, posts);
	const statePath = path.join(cwd, ".private-posts/state.json");
	const state = existsSync(statePath)
		? JSON.parse(readFileSync(statePath, "utf8"))
		: {};
	const active = bundles.filter(
		(post) => readUpload(post.source, post.filename) && !post.data.draft,
	);
	if (dryRun) return active.map((post) => post.filename);
	if (active.length && password === undefined) {
		const envPath = path.join(cwd, ".env.private");
		if (existsSync(envPath)) process.loadEnvFile(envPath);
		password = process.env.BLOG_PRIVATE_PASSWORD;
	}
	if (active.length && (!password || [...password].length < 16)) {
		throw new Error(
			"Set BLOG_PRIVATE_PASSWORD (at least 16 characters) in the ignored .env.private file. Run pnpm privacy:init first.",
		);
	}
	const next = {};
	const writes = [];
	for (const post of active) {
		const payload = renderPrivatePost(cwd, post);
		const digest = createHash("sha256")
			.update(JSON.stringify(payload))
			.update(password)
			.digest("hex");
		const old = state[post.filename];
		const id = old?.id || randomBytes(16).toString("hex");
		if (!/^[a-f0-9]{32}$/.test(id))
			throw new Error("Invalid local private-post state.");
		next[post.filename] = { id, digest };
		const output = path.join(cwd, encryptedDirectory, `${id}.json`);
		if (old?.digest !== digest || !existsSync(output))
			writes.push([
				output,
				`${JSON.stringify(await encryptPayload(payload, password))}\n`,
			]);
	}
	// Finish all validation/encryption before changing any ciphertext files.
	for (const [output, contents] of writes) {
		mkdirSync(path.dirname(output), { recursive: true });
		writeFileSync(`${output}.tmp`, contents);
		renameSync(`${output}.tmp`, output);
	}
	for (const [filename, old] of Object.entries(state)) {
		if (!next[filename] && /^[a-f0-9]{32}$/.test(old.id))
			rmSync(path.join(cwd, encryptedDirectory, `${old.id}.json`), {
				force: true,
			});
	}
	if (active.length || existsSync(statePath)) {
		mkdirSync(path.dirname(statePath), { recursive: true });
		writeFileSync(statePath, `${JSON.stringify(next, null, 2)}\n`);
	}
	console.log(
		`Private posts: ${active.length} encrypted, ${writes.length} updated. Plaintext stays local.`,
	);
	return active.map((post) => post.filename);
}

if (
	process.argv[1] &&
	fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
	preparePrivatePosts().catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
