export interface PrivatePayload {
	title: string;
	html: string;
	assets: { id: string; name: string; type: string; data: string }[];
}
export function decryptPrivatePost(
	envelope: Record<string, unknown>,
	password: string,
): Promise<PrivatePayload>;
