import "../styles/mermaid.css";

let mermaidModule: Promise<typeof import("mermaid")> | undefined;
let renderQueue = Promise.resolve();

async function renderDiagrams() {
	const sources = document.querySelectorAll<HTMLPreElement>(
		".custom-md pre.mermaid-source",
	);
	if (!sources.length) return;

	mermaidModule ??= import("mermaid");
	const { default: mermaid } = await mermaidModule;
	await document.fonts.ready;

	const theme = document.documentElement.classList.contains("dark")
		? "dark"
		: "default";
	mermaid.initialize({
		startOnLoad: false,
		securityLevel: "strict",
		suppressErrorRendering: true,
		theme,
		htmlLabels: false,
		fontFamily: 'Roboto, "Microsoft YaHei", "PingFang SC", sans-serif',
		flowchart: { useMaxWidth: true },
	});

	for (const source of sources) {
		if (!source.isConnected) continue;

		let figure = source.closest<HTMLElement>(".mermaid-diagram");
		if (!figure) {
			figure = document.createElement("figure");
			figure.className = "mermaid-diagram not-prose";

			const canvas = document.createElement("div");
			canvas.className = "mermaid-canvas";
			canvas.tabIndex = 0;
			canvas.setAttribute("role", "region");
			canvas.setAttribute("aria-label", "图表，可横向滚动查看");

			const details = document.createElement("details");
			details.className = "mermaid-details";
			const summary = document.createElement("summary");
			summary.textContent = "查看图表源码";
			source.replaceWith(figure);
			details.append(summary, source);
			figure.append(canvas, details);
		}
		if (figure.dataset.mermaidTheme === theme) continue;

		const canvas = figure.querySelector<HTMLElement>(".mermaid-canvas");
		const details = figure.querySelector<HTMLDetailsElement>("details");
		if (!canvas || !details) continue;

		try {
			const { svg } = await mermaid.render(
				`mermaid-${crypto.randomUUID()}`,
				source.textContent ?? "",
			);
			if (!figure.isConnected) continue;
			canvas.innerHTML = svg;
			const diagram = canvas.querySelector("svg");
			if (diagram?.viewBox.baseVal.width) {
				canvas.style.setProperty(
					"--mermaid-width",
					`${diagram.viewBox.baseVal.width}px`,
				);
			}
			figure.dataset.mermaidTheme = theme;
		} catch (error) {
			canvas.textContent = "图表暂时无法显示，可展开查看源码。";
			details.open = true;
			console.error("Unable to render Mermaid diagram", error);
		}
	}
}

function renderMermaidDiagrams() {
	// Serialize renders so navigation and theme changes cannot race initialization.
	renderQueue = renderQueue.then(renderDiagrams).catch((error) => {
		mermaidModule = undefined;
		console.error("Unable to load Mermaid", error);
	});
}

renderMermaidDiagrams();
document.addEventListener("astro:page-load", renderMermaidDiagrams);

const setupNavigation = () => {
	window.swup.hooks.on("page:view", renderMermaidDiagrams);
};
if (window.swup?.hooks) {
	setupNavigation();
} else {
	document.addEventListener("swup:enable", setupNavigation, { once: true });
}

let darkMode = document.documentElement.classList.contains("dark");
new MutationObserver(() => {
	const nextDarkMode = document.documentElement.classList.contains("dark");
	if (nextDarkMode === darkMode) return;
	darkMode = nextDarkMode;
	renderMermaidDiagrams();
}).observe(document.documentElement, {
	attributes: true,
	attributeFilter: ["class"],
});
