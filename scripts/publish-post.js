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

function sleep(milliseconds) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function pushWithRetry(maxAttempts = 3) {
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		console.log(`Push attempt ${attempt}/${maxAttempts}...`);
		const result = spawnSync("git", ["push", "origin", "main"], {
			stdio: "inherit",
			shell: false,
		});
		if (result.status === 0) return;

		if (attempt < maxAttempts) {
			const delay = attempt * 5000;
			console.log(`Push failed. Retrying in ${delay / 1000} seconds...`);
			sleep(delay);
		}
	}

	console.error(
		"Push failed after 3 attempts. The commit is safe locally; run pnpm publish-post again or git push origin main later.",
	);
	process.exit(1);
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
	const unpushedCommits = Number(
		output("git", ["rev-list", "--count", "origin/main..HEAD"]),
	);
	if (unpushedCommits > 0) {
		console.log(
			`No new article changes. Retrying ${unpushedCommits} unpushed commit(s)...\n`,
		);
		pushWithRetry();
		console.log(
			"\nPublished. GitHub Actions is now building and deploying the blog.",
		);
		process.exit(0);
	}

	console.log("No article changes or unpushed commits found.");
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
pushWithRetry();

console.log(
	"\nPublished. GitHub Actions is now building and deploying the blog.",
);
