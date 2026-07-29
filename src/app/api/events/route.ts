import { invalidationBus } from '@/lib/sync/events';
import { SSE_HEARTBEAT_MS } from '@/lib/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The single realtime channel: it carries invalidation notices only, so the
 * client refetches through the normal read paths and there is never a second
 * copy of the data to keep in sync.
 */
export async function GET(request: Request) {
	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (payload: string) => {
				try {
					controller.enqueue(encoder.encode(payload));
				} catch {
					// Client vanished mid-write; cleanup runs below.
				}
			};

			send(': connected\n\n');

			const unsubscribe = invalidationBus.subscribe((event) => {
				send(`data: ${JSON.stringify(event)}\n\n`);
			});

			const heartbeat = setInterval(() => send(': ping\n\n'), SSE_HEARTBEAT_MS);

			const close = () => {
				clearInterval(heartbeat);
				unsubscribe();
				try {
					controller.close();
				} catch {
					// Already closed.
				}
			};

			request.signal.addEventListener('abort', close);
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
}
