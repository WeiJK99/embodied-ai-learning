import { type CollectionEntry, getCollection } from "astro:content";

export type BlogPost = CollectionEntry<"posts"> & {
	slug: string;
	sourceId: string;
};

export async function getBlogPosts(): Promise<BlogPost[]> {
	const posts = await getCollection(
		"posts",
		({ data }) =>
			data.access !== "private" &&
			(!import.meta.env.PROD || (!data.draft && data.upload)),
	);
	return posts.map((post) => ({
		...post,
		slug: post.id,
		sourceId: (post.filePath || "").replace(/^src\/content\/posts\//, ""),
	}));
}
