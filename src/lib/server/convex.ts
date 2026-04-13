import { ConvexHttpClient } from 'convex/browser';
import { env } from '$env/dynamic/public';

let client: ConvexHttpClient | undefined;

export function getConvexClient(): ConvexHttpClient {
	if (!client) {
		const url = env.PUBLIC_CONVEX_URL;
		if (!url) {
			throw new Error('Missing required environment variable: PUBLIC_CONVEX_URL');
		}
		client = new ConvexHttpClient(url);
	}
	return client;
}
