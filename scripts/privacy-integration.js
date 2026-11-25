import path from "node:path";
import { fileURLToPath } from "node:url";
import { createUploadFilter } from "./post-upload.js";
import { scanPosts, walkFiles } from "./private-posts.js";

export default function privacyIntegration() {
	return {
		name: "private-source-protection",
		hooks: {
			"astro:config:setup": ({ config, updateConfig, command }) => {
				const cwd = fileURLToPath(config.root);
				const forbidden = () => {
					const posts = scanPosts(cwd);
					const canUpload = createUploadFilter(posts);
					return (filename) => {
						const relative = path.relative(cwd, filename).replaceAll("\\", "/");
						return (
							posts.some(
								(post) =>
									post.data.access === "private" &&
									(relative === post.filename ||
										relative.startsWith(
											`${path.posix.dirname(post.filename)}/`,
										)),
							) ||
							(command === "build" && !canUpload(relative))
						);
					};
				};
				let blocked = forbidden();
				updateConfig({
					vite: {
						plugins: [
							{
								name: "private-source-protection",
								enforce: "pre",
								buildStart() {
									blocked = forbidden();
								},
								resolveId(id) {
									if (id === "virtual:blog-images")
										return "\0virtual:blog-images";
								},
								load(id) {
									if (id === "\0virtual:blog-images") {
										const currentBlocked = forbidden();
										const entries = walkFiles(path.join(cwd, "src")).filter(
											(filename) =>
												/\.(png|jpe?g|gif|webp|avif|svg|ico)$/i.test(
													filename,
												) && !currentBlocked(path.join(cwd, "src", filename)),
										);
										return `export default {${entries.map((filename) => `${JSON.stringify(`../../${filename}`)}: () => import(${JSON.stringify(`/src/${filename}`)})`).join(",")}};`;
									}
									const filename = id.split("?")[0];
									if (path.isAbsolute(filename) && blocked(filename))
										throw new Error(
											"A public page tried to import a private/local-only source or attachment. Keep private assets in their article's directory.",
										);
								},
							},
						],
					},
				});
			},
		},
	};
}
