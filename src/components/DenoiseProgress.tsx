'use client';

import { useEffect, useRef, useState } from 'react';
import { DENOISE_TIMES, type DenoiseAlgorithm } from '@/lib/types';
import { formatDuration } from '@/lib/utils';

/** How long without a new DNG before the run is treated as finished. */
const IDLE_MS = 5 * 60 * 1000;

/**
 * Progress is just the indexed count of the denoised stage — there is no
 * dedicated watcher any more, the sync engine's updates arrive on the same
 * invalidation stream as everything else.
 */
export function DenoiseProgress({
	current,
	expected,
	algorithm
}: {
	current: number;
	expected: number;
	algorithm: DenoiseAlgorithm | null;
}) {
	const [selected, setSelected] = useState<DenoiseAlgorithm>(algorithm ?? 'DeepPRIME 3');
	const [idle, setIdle] = useState(false);
	const lastChange = useRef(0);
	const lastCount = useRef(current);
	const notified = useRef(false);

	useEffect(() => {
		if (lastChange.current === 0) lastChange.current = Date.now();
		if (current !== lastCount.current) {
			lastCount.current = current;
			lastChange.current = Date.now();
			setIdle(false);
			notified.current = false;
		}
	}, [current]);

	useEffect(() => {
		const timer = setInterval(() => {
			const quiet = Date.now() - lastChange.current >= IDLE_MS;
			setIdle(quiet && current > 0);

			if (quiet && current > 0 && !notified.current && 'Notification' in window) {
				notified.current = true;
				if (Notification.permission === 'granted') {
					new Notification('Processing complete', { body: `${current} DNGs ready.` });
				}
			}
		}, 10_000);
		return () => clearInterval(timer);
	}, [current]);

	const remaining = Math.max(0, expected - current);
	const pct = expected > 0 ? Math.min(100, (current / expected) * 100) : 0;
	const complete = expected > 0 && current >= expected;

	return (
		<div className="card space-y-3">
			<div className="flex items-center justify-between gap-3">
				<div>
					<p className="text-sm font-medium tabular-nums">
						{current} {expected > 0 && <span className="text-ink-muted">/ {expected}</span>} DNGs
					</p>
					<p className="text-ink-muted mt-0.5 text-xs">
						{complete
							? 'All raws accounted for'
							: idle
								? 'No new files for 5 minutes — PureRAW is probably done'
								: remaining > 0
									? `~${formatDuration(remaining * DENOISE_TIMES[selected])} remaining`
									: 'Waiting for PureRAW output'}
					</p>
				</div>

				<select
					className="input w-40 text-xs"
					value={selected}
					onChange={(e) => setSelected(e.target.value as DenoiseAlgorithm)}
					aria-label="Denoise algorithm for the estimate"
				>
					<option value="DeepPRIME 3">DeepPRIME 3</option>
					<option value="DeepPRIME XD3">DeepPRIME XD3</option>
				</select>
			</div>

			<div className="bg-active h-1.5 overflow-hidden rounded-full">
				<div
					className={`h-full transition-[width] duration-500 ${complete ? 'bg-good' : 'bg-accent'}`}
					style={{ width: `${pct}%` }}
				/>
			</div>

			{'Notification' in globalThis && Notification.permission === 'default' && (
				<button
					type="button"
					className="btn-ghost btn-sm"
					onClick={() => void Notification.requestPermission()}
				>
					Notify me when it finishes
				</button>
			)}
		</div>
	);
}
