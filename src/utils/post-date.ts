type PostDates = {
	created?: Date;
	create?: Date;
	published: Date;
};

// Research notes may use published for the paper's date, not the blog's date.
// `create` is accepted as an alias of `created`.
export function getBlogDate(data: PostDates): Date {
	return data.created ?? data.create ?? data.published;
}

export function comparePostsByDate(
	a: { slug: string; data: PostDates },
	b: { slug: string; data: PostDates },
): number {
	return (
		getBlogDate(b.data).getTime() - getBlogDate(a.data).getTime() ||
		(a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)
	);
}
