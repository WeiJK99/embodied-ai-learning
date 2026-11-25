declare module "virtual:blog-images" {
	const images: Record<
		string,
		() => Promise<{ default: import("astro").ImageMetadata }>
	>;
	export default images;
}
