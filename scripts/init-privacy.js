import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, writeFileSync } from "node:fs";

const current = spawnSync("git", ["config", "--get", "core.hooksPath"], {
	encoding: "utf8",
	stdio: "pipe",
});
if (current.error) throw current.error;
if (current.stdout.trim() && current.stdout.trim() !== ".githooks")
	throw new Error(
		"A custom core.hooksPath already exists. Add the private-source checks to your existing hooks before publishing.",
	);
if (!existsSync(".env.private")) {
	writeFileSync(
		".env.private",
		`# Local only. Never share or commit this file. Back up this password securely.\nBLOG_PRIVATE_PASSWORD=${randomBytes(32).toString("base64url")}\n`,
		{ flag: "wx", mode: 0o600 },
	);
}
chmodSync(".githooks/pre-commit", 0o755);
chmodSync(".githooks/pre-push", 0o755);
const result = spawnSync(
	"git",
	["config", "--local", "core.hooksPath", ".githooks"],
	{ stdio: "inherit" },
);
if (result.error || result.status !== 0)
	throw result.error || new Error("Unable to configure private-source hooks.");
console.log(
	"Privacy ready. Password is in ignored .env.private; Git commit/push guards enabled. Keep a secure backup of the password and .private-posts/state.json.",
);
