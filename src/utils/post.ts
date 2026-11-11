import { getCollection } from "astro:content";
import { comparePostsByDate } from "./post-date";

// 分类树节点类型（支持任意层级嵌套）
export interface CategoryNode {
	name: string; // 当前层级名，如「梯度下降」
	fullName: string; // 完整路径，如「基础知识/深度学习/梯度下降」
	count: number; // 经过该节点的文章总数（含所有后代）
	directCount: number; // 精确归属于该节点（category 完全等于 fullName）的文章数
	children: CategoryNode[];
}

interface MutableNode {
	name: string;
	fullName: string;
	count: number;
	directCount: number;
	children: Map<string, MutableNode>;
}

/** 把一个分类字符串拆成去空白、去空段的层级数组。 */
function toSegments(category: string): string[] {
	return category
		.split("/")
		.map((s) => s.trim())
		.filter(Boolean);
}

/** 递归把可变节点 Map 转为排好序的只读节点数组。 */
function finalize(level: Map<string, MutableNode>): CategoryNode[] {
	return Array.from(level.values())
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((n) => ({
			name: n.name,
			fullName: n.fullName,
			count: n.count,
			directCount: n.directCount,
			children: finalize(n.children),
		}));
}

/**
 * 解析所有文章的分类，生成任意层级的树形结构（含文章计数）。
 * 例：category 为「基础知识/深度学习/梯度下降」会生成
 *     基础知识 -> 深度学习 -> 梯度下降 三层节点，且每个祖先节点计数都 +1。
 */
export async function getCategoryTree(): Promise<CategoryNode[]> {
	// 获取文章：生产环境排除草稿，开发环境全部显示
	const posts = await getCollection("posts", ({ data }) =>
		import.meta.env.PROD ? data.draft !== true : true,
	);

	const roots = new Map<string, MutableNode>();

	for (const post of posts) {
		const raw = post.data.category;
		if (!raw) continue;
		const segments = toSegments(String(raw));
		if (segments.length === 0) continue;

		let level = roots;
		const pathParts: string[] = [];
		segments.forEach((seg, i) => {
			pathParts.push(seg);
			const fullName = pathParts.join("/");

			let node = level.get(seg);
			if (!node) {
				node = {
					name: seg,
					fullName,
					count: 0,
					directCount: 0,
					children: new Map(),
				};
				level.set(seg, node);
			}
			node.count++; // 每个祖先与叶子都为这篇文章计数
			if (i === segments.length - 1) {
				node.directCount++;
			}
			level = node.children;
		});
	}

	return finalize(roots);
}

/**
 * 取出属于某个分类的文章。
 * 传入任意层级的分类路径（如「基础知识」「基础知识/深度学习」「基础知识/深度学习/梯度下降」），
 * 返回该路径下精确匹配，以及所有更深层后代分类的文章。
 */
export async function getPostsByCategory(category: string) {
	const target = category.trim();
	const posts = await getCollection("posts", ({ data }) =>
		import.meta.env.PROD ? data.draft !== true : true,
	);

	const filtered = posts.filter((post) => {
		const current = String(post.data.category ?? "").trim();
		if (!current) return false;
		// 精确匹配，或属于该分类下更深的后代分类
		return current === target || current.startsWith(`${target}/`);
	});

	return filtered.sort(comparePostsByDate);
}
