import 'server-only';
import { EventEmitter } from 'node:events';
import type { PhysicalStage } from '../config';
import type { InvalidationEvent } from '../types';

/**
 * The one realtime channel. Only invalidation notices travel here — clients
 * refetch through the normal read paths, so there is no second copy of the
 * data to keep consistent.
 */
class InvalidationBus {
	private emitter = new EventEmitter();

	constructor() {
		// Every SSE connection attaches a listener; a busy tab count is normal.
		this.emitter.setMaxListeners(0);
	}

	emit(folderName: string | null, stages: PhysicalStage[]): void {
		const event: InvalidationEvent = {
			folderName,
			stages,
			at: new Date().toISOString()
		};
		this.emitter.emit('invalidate', event);
	}

	subscribe(listener: (event: InvalidationEvent) => void): () => void {
		this.emitter.on('invalidate', listener);
		return () => this.emitter.off('invalidate', listener);
	}
}

const globalForBus = globalThis as unknown as { photopipeBus?: InvalidationBus };

export const invalidationBus = globalForBus.photopipeBus ?? new InvalidationBus();

if (process.env.NODE_ENV !== 'production') globalForBus.photopipeBus = invalidationBus;
