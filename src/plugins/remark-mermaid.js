import { visit } from "unist-util-visit";

// Preserve Mermaid source before Expressive Code handles ordinary code fences.
export function remarkMermaid() {
	return (tree) => {
		visit(tree, "code", (node) => {
			if (node.lang?.toLowerCase() !== "mermaid") return;

			const source = node.value
				.replaceAll("&", "&amp;")
				.replaceAll("<", "&lt;")
				.replaceAll(">", "&gt;");
			node.type = "html";
			node.value = `<pre class="mermaid-source"><code>${source}</code></pre>`;
			delete node.lang;
			delete node.meta;
		});
	};
}
