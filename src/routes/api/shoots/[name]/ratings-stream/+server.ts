import type { RequestHandler } from './$types.js';
import { error } from '@sveltejs/kit';
import { SHOOT_PATTERN } from '$lib/server/config.js';
import { ratingBroadcaster } from '$lib/server/rating-broadcaster.js';

export const GET: RequestHandler = async ({ params }) => {
	const shootName = decodeURIComponent(params.name);

	if (!SHOOT_PATTERN.test(shootName) || shootName.includes('..')) {
		error(400, 'Invalid shoot name');
	}

	const stream = ratingBroadcaster.subscribe(shootName);

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
