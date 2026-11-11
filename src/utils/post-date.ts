type PostDates = {
	created?: Date;
	published: Date;
};

// Research notes may use published for the paper's date, not the blog's date.
export function getBlogDate(data: PostDates): Date {
	return data.created ?? data.published;
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
