import assert from "node:assert/strict";
import test from "node:test";
import { remarkMermaid } from "../src/plugins/remark-mermaid.js";

test("Mermaid fences bypass code highlighting while ordinary code is preserved", () => {
	const mermaid = {
		type: "code",
		lang: "mermaid",
		value: "flowchart LR\nA --> B",
	};
	const javascript = { type: "code", lang: "js", value: "const a = 1;" };
	const tree = { type: "root", children: [mermaid, javascript] };
	remarkMermaid()(tree);
	assert.equal(mermaid.type, "html");
	assert.ok(mermaid.value.includes('class="mermaid-source"'));
	assert.ok(mermaid.value.includes("A --&gt; B"));
	assert.deepEqual(javascript, {
		type: "code",
		lang: "js",
		value: "const a = 1;",
	});
});

test("diagram labels and HTML-like text remain literal source rather than markup", () => {
	const node = {
		type: "code",
		lang: "MERMAID",
		value: 'flowchart TD\nA["<script>&</script>"]',
	};
	remarkMermaid()({ type: "root", children: [node] });
	assert.ok(node.value.includes("&lt;script&gt;&amp;&lt;/script&gt;"));
	assert.ok(!node.value.includes("<script>"));
});
