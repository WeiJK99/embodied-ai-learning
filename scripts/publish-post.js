import { spawnSync } from "node:child_process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const commitMessage = process.argv.slice(2).join(" ").trim();
const message = commitMessage
	? `content: ${commitMessage}`
	: `content: publish article ${new Date().toISOString().slice(0, 10)}`;

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		stdio: "inherit",
		shell: false,
		...options,
	});

	if (result.error) {
		console.error(result.error.message);
		process.exit(1);
	}
	if (result.status !== 0) process.exit(result.status ?? 1);
}

function output(command, args) {
	const result = spawnSync(command, args, {
		encoding: "utf8",
		shell: false,
	});
	if (result.status !== 0) process.exit(result.status ?? 1);
	return result.stdout.trim();
}

const branch = output("git", ["branch", "--show-current"]);
if (branch !== "main") {
	console.error(
		`Publish stopped: current branch is "${branch}", expected "main".`,
	);
	process.exit(1);
}

const articleChanges = output("git", [
	"status",
	"--porcelain",
	"--",
	"src/content/posts",
]);
if (!articleChanges) {
	console.log("No article changes found in src/content/posts.");
	process.exit(0);
}

console.log("\n[1/4] Building the production site...\n");
run(pnpm, ["build"], { shell: process.platform === "win32" });

console.log("\n[2/4] Staging article files...\n");
run("git", ["add", "--", "src/content/posts"]);

const staged = spawnSync("git", [
	"diff",
	"--cached",
	"--quiet",
	"--",
	"src/content/posts",
]);
if (staged.status === 0) {
	console.log("No publishable article changes found.");
	process.exit(0);
}

console.log("\n[3/4] Creating the commit...\n");
run("git", ["commit", "-m", message]);

console.log("\n[4/4] Pushing to GitHub...\n");
run("git", ["push", "origin", "main"]);

console.log(
	"\nPublished. GitHub Actions is now building and deploying the blog.",
);
