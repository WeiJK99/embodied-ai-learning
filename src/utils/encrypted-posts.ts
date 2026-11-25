import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export function getEncryptedPosts() {
	const directory = path.resolve("encrypted-posts");
	if (!existsSync(directory)) return [];
	return readdirSync(directory)
		.filter((name) => /^[a-f0-9]{32}\.json$/.test(name))
		.sort()
		.map((name) => ({
			id: name.slice(0, -5),
			envelope: JSON.parse(readFileSync(path.join(directory, name), "utf8")),
		}));
}
