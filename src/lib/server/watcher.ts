import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { CAMERA_BASE, DENOISED_DIR, SHOOT_PATTERN } from './config.js';
import type { DenoiseEvent } from '$lib/types.js';

const POLL_INTERVAL = 2000; // 2 seconds
const IDLE_THRESHOLD = 5 * 60 * 1000; // 5 minutes
const STABLE_SIZE_THRESHOLD = 2; // File must have same size for 2 consecutive polls

interface FileEntry {
	name: string;
	size: number;
	stablePollCount: number;
}

interface WatchSession {
	shootName: string;
	interval: ReturnType<typeof setInterval>;
	subscribers: Set<ReadableStreamDefaultController<Uint8Array>>;
	knownFiles: Map<string, FileEntry>;
	lastActivityTime: number;
	idleNotified: boolean;
}

class DenoiseWatcher {
	private sessions = new Map<string, WatchSession>();
	private encoder = new TextEncoder();

	/**
	 * Subscribe to denoise progress for a shoot.
	 * Returns a ReadableStream suitable for SSE response.
	 */
	subscribe(shootName: string): ReadableStream<Uint8Array> {
		return new ReadableStream<Uint8Array>({
			start: (controller) => {
				let session = this.sessions.get(shootName);

				if (!session) {
					session = this.startSession(shootName);
				}

				session.subscribers.add(controller);

				// Send initial state immediately
				const stableCount = this.getStableCount(session);
				const latestFile = this.getLatestFile(session);
				this.sendEvent(controller, {
					type: 'file',
					dngCount: stableCount,
					latestFile,
					timestamp: new Date().toISOString()
				});
			},
			cancel: (controller) => {
				const session = this.sessions.get(shootName);
				if (!session) return;

				// The controller passed to cancel is not the same reference,
				// so we clean up differently
				this.removeSubscriber(
					shootName,
					controller as unknown as ReadableStreamDefaultController<Uint8Array>
				);
			}
		});
	}

	/**
	 * Remove a subscriber. If no subscribers remain, stop the session.
	 */
	private removeSubscriber(
		shootName: string,
		controller: ReadableStreamDefaultController<Uint8Array>
	): void {
		const session = this.sessions.get(shootName);
		if (!session) return;

		session.subscribers.delete(controller);

		if (session.subscribers.size === 0) {
			clearInterval(session.interval);
			this.sessions.delete(shootName);
		}
	}

	/**
	 * Unsubscribe a specific controller by reference.
	 */
	unsubscribe(shootName: string, controller: ReadableStreamDefaultController<Uint8Array>): void {
		this.removeSubscriber(shootName, controller);
	}

	private startSession(shootName: string): WatchSession {
		const session: WatchSession = {
			shootName,
			interval: setInterval(() => this.poll(shootName), POLL_INTERVAL),
			subscribers: new Set(),
			knownFiles: new Map(),
			lastActivityTime: Date.now(),
			idleNotified: false
		};

		this.sessions.set(shootName, session);

		// Run first poll immediately
		this.poll(shootName);

		return session;
	}

	private async poll(shootName: string): Promise<void> {
		const session = this.sessions.get(shootName);
		if (!session) return;

		// Validate shoot name
		if (!SHOOT_PATTERN.test(shootName) || shootName.includes('..')) return;

		const denoisedPath = join(CAMERA_BASE, shootName, DENOISED_DIR);

		let entries: string[];
		try {
			entries = await readdir(denoisedPath);
		} catch {
			return; // Directory might not exist yet
		}

		const dngFiles = entries.filter((f) => f.toLowerCase().endsWith('.dng'));

		let hasNewStableFile = false;

		for (const fileName of dngFiles) {
			const existing = session.knownFiles.get(fileName);

			try {
				const info = await stat(join(denoisedPath, fileName));
				const size = info.size;

				if (!existing) {
					// New file — start tracking, not yet stable
					session.knownFiles.set(fileName, { name: fileName, size, stablePollCount: 1 });
				} else if (existing.size === size) {
					// Same size as last poll — increment stability
					existing.stablePollCount++;
					if (existing.stablePollCount === STABLE_SIZE_THRESHOLD) {
						hasNewStableFile = true;
					}
				} else {
					// Size changed — still writing
					existing.size = size;
					existing.stablePollCount = 1;
				}
			} catch {
				// Skip files we can't stat
			}
		}

		// Remove files that disappeared
		for (const [name] of session.knownFiles) {
			if (!dngFiles.includes(name)) {
				session.knownFiles.delete(name);
				hasNewStableFile = true; // Count change
			}
		}

		const stableCount = this.getStableCount(session);
		const latestFile = this.getLatestFile(session);

		if (hasNewStableFile) {
			session.lastActivityTime = Date.now();
			session.idleNotified = false;

			this.broadcast(session, {
				type: 'file',
				dngCount: stableCount,
				latestFile,
				timestamp: new Date().toISOString()
			});
		}

		// Check for idle
		const idleMs = Date.now() - session.lastActivityTime;
		if (idleMs >= IDLE_THRESHOLD && !session.idleNotified && stableCount > 0) {
			session.idleNotified = true;
			this.broadcast(session, {
				type: 'idle',
				dngCount: stableCount,
				latestFile,
				idleMinutes: Math.round(idleMs / 60000),
				timestamp: new Date().toISOString()
			});
		}
	}

	private getStableCount(session: WatchSession): number {
		let count = 0;
		for (const entry of session.knownFiles.values()) {
			if (entry.stablePollCount >= STABLE_SIZE_THRESHOLD) count++;
		}
		return count;
	}

	private getLatestFile(session: WatchSession): string | null {
		let latest: string | null = null;
		for (const entry of session.knownFiles.values()) {
			if (entry.stablePollCount >= STABLE_SIZE_THRESHOLD) {
				latest = entry.name;
			}
		}
		return latest;
	}

	private broadcast(session: WatchSession, event: DenoiseEvent): void {
		const data = this.encoder.encode(`data: ${JSON.stringify(event)}\n\n`);

		const dead: ReadableStreamDefaultController<Uint8Array>[] = [];

		for (const controller of session.subscribers) {
			try {
				controller.enqueue(data);
			} catch {
				dead.push(controller);
			}
		}

		for (const controller of dead) {
			session.subscribers.delete(controller);
		}

		if (session.subscribers.size === 0) {
			clearInterval(session.interval);
			this.sessions.delete(session.shootName);
		}
	}

	private sendEvent(
		controller: ReadableStreamDefaultController<Uint8Array>,
		event: DenoiseEvent
	): void {
		try {
			const data = this.encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
			controller.enqueue(data);
		} catch {
			// Controller closed
		}
	}
}

/** Singleton watcher instance */
export const denoiseWatcher = new DenoiseWatcher();
