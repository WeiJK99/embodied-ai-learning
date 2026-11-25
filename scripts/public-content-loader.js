import path from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "astro/loaders";
import { readUpload } from "./post-upload.js";
import { scanPosts } from "./private-posts.js";

export function publicContentLoader() {
	return {
		name: "public-posts-only",
		async load(context) {
			const cwd = fileURLToPath(context.config.root);
			const refresh = async () => {
				const posts = scanPosts(cwd).filter(
					(post) =>
						post.data.access !== "private" &&
						(process.env.NODE_ENV !== "production" ||
							(!post.data.draft && readUpload(post.source, post.filename))),
				);
				// Clear first, including when the last public article becomes private.
				context.store.clear();
				if (!posts.length) return;
				const patterns = posts.map((post) =>
					post.filename
						.slice("src/content/posts/".length)
						.replace(/[?*{}[\]()!+@]/g, "\\$&"),
				);
				await glob({ pattern: patterns, base: "./src/content/posts" }).load({
					...context,
					watcher: undefined,
				});
			};
			await refresh();
			if (context.watcher) {
				const directory = path.join(cwd, "src/content/posts");
				context.watcher.add(directory);
				let queue = Promise.resolve();
				for (const event of ["add", "change", "unlink"])
					context.watcher.on(event, (filename) => {
						if (!path.relative(directory, filename).startsWith("..")) {
							queue = queue
								.then(refresh)
								.catch((error) => context.logger.error(error.message));
						}
					});
			}
		},
	};
}
