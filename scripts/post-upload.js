import path from "node:path";
import { load } from "js-yaml";

export const postsDirectory = "src/content/posts";

export function readUpload(source, filename) {
	const frontmatter =
		/^\uFEFF?---[\t ]*\r?\n([\s\S]*?)^---[\t ]*(?:\r?\n|$)/m.exec(source);
	const value =
		frontmatter?.index === 0 ? load(frontmatter[1])?.upload : undefined;
	if (value === undefined || value === "yes" || value === true) return true;
	if (value === "no" || value === false) return false;
	throw new Error(`${filename}: upload must be yes/no or true/false.`);
}

export function isPost(filename) {
	return (
		/\.(md|mdx)$/i.test(filename) &&
		!filename.split("/").some((part) => /^[_.]/.test(part))
	);
}

// Each article directory owns its attachments. Nested article directories can
// override their parent's policy; flat posts only control their Markdown file.
export function createUploadFilter(posts) {
	const articlePolicies = new Map();
	const directoryPolicies = new Map();
	for (const { filename, source } of posts) {
		if (!isPost(filename)) continue;
		const upload = readUpload(source, filename);
		articlePolicies.set(filename, upload);
		const directory = path.posix.dirname(filename);
		directoryPolicies.set(
			directory,
			(directoryPolicies.get(directory) ?? true) && upload,
		);
	}

	return (filename) => {
		if (articlePolicies.has(filename)) return articlePolicies.get(filename);
		let directory = path.posix.dirname(filename);
		while (directory.startsWith(`${postsDirectory}/`)) {
			if (directoryPolicies.has(directory)) {
				return directoryPolicies.get(directory);
			}
			directory = path.posix.dirname(directory);
		}
		return true;
	};
}
