import type { StarRating } from '$lib/types.js';

class RatingBroadcaster {
	private subscribers = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();
	private encoder = new TextEncoder();

	subscribe(shootName: string): ReadableStream<Uint8Array> {
		return new ReadableStream<Uint8Array>({
			start: (controller) => {
				let subs = this.subscribers.get(shootName);
				if (!subs) {
					subs = new Set();
					this.subscribers.set(shootName, subs);
				}
				subs.add(controller);
			},
			cancel: () => {
				const subs = this.subscribers.get(shootName);
				if (!subs) return;
				// On cancel we can't match the exact controller reference,
				// but dead controllers get pruned on next broadcast
			}
		});
	}

	broadcast(shootName: string, ratings: Record<string, StarRating>): void {
		const subs = this.subscribers.get(shootName);
		if (!subs || subs.size === 0) return;

		const data = this.encoder.encode(`data: ${JSON.stringify({ ratings })}\n\n`);
		const dead: ReadableStreamDefaultController<Uint8Array>[] = [];

		for (const controller of subs) {
			try {
				controller.enqueue(data);
			} catch {
				dead.push(controller);
			}
		}

		for (const controller of dead) {
			subs.delete(controller);
		}

		if (subs.size === 0) {
			this.subscribers.delete(shootName);
		}
	}
}

export const ratingBroadcaster = new RatingBroadcaster();
