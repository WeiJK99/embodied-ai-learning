const decode = (value) =>
	Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

export async function decryptPrivatePost(envelope, password) {
	if (
		envelope.version !== 1 ||
		envelope.kdf !== "PBKDF2-SHA256" ||
		envelope.iterations !== 600_000
	)
		throw new Error("Unsupported encrypted article.");
	const salt = decode(envelope.salt);
	const iv = decode(envelope.iv);
	if (salt.length !== 16 || iv.length !== 12)
		throw new Error("Invalid encrypted article.");
	const material = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password),
		"PBKDF2",
		false,
		["deriveKey"],
	);
	const key = await crypto.subtle.deriveKey(
		{ name: "PBKDF2", hash: "SHA-256", salt, iterations: envelope.iterations },
		material,
		{ name: "AES-GCM", length: 256 },
		false,
		["decrypt"],
	);
	const plaintext = await crypto.subtle.decrypt(
		{
			name: "AES-GCM",
			iv,
			additionalData: new TextEncoder().encode("blog-private-post:v1"),
			tagLength: 128,
		},
		key,
		decode(envelope.ciphertext),
	);
	return JSON.parse(new TextDecoder().decode(plaintext));
}
