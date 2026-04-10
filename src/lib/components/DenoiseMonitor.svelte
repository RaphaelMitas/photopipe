<script lang="ts">
	import { onMount } from 'svelte';
	import { DENOISE_TIMES } from '$lib/types.js';
	import type { DenoiseAlgorithm, DenoiseEvent } from '$lib/types.js';
	import { formatDuration } from '$lib/utils.js';

	let {
		shootName,
		expectedTotal,
		currentCount,
		algorithm
	}: {
		shootName: string;
		expectedTotal: number;
		currentCount: number;
		algorithm: DenoiseAlgorithm | null;
	} = $props();

	let dngCount = $state(0);
	let latestFile = $state<string | null>(null);
	let isIdle = $state(false);
	let connected = $state(false);
	let selectedAlgorithm = $state<DenoiseAlgorithm>('DeepPRIME 3');

	$effect(() => { dngCount = currentCount; });
	$effect(() => { selectedAlgorithm = algorithm ?? 'DeepPRIME 3'; });

	let progress = $derived(expectedTotal > 0 ? Math.min(dngCount / expectedTotal, 1) : 0);
	let remaining = $derived(
		expectedTotal > 0 ? Math.max(0, expectedTotal - dngCount) * DENOISE_TIMES[selectedAlgorithm] : 0
	);

	let notificationPermission = $state<NotificationPermission>('default');

	onMount(() => {
		if ('Notification' in window) notificationPermission = Notification.permission;
		const es = new EventSource(`/api/watch/${encodeURIComponent(shootName)}`);
		es.onopen = () => { connected = true; };
		es.onmessage = (e) => {
			try {
				const ev: DenoiseEvent = JSON.parse(e.data);
				dngCount = ev.dngCount;
				latestFile = ev.latestFile;
				if (ev.type === 'idle') { isIdle = true; notify(ev); } else { isIdle = false; }
			} catch {}
		};
		es.onerror = () => { connected = false; };
		return () => es.close();
	});

	function notify(ev: DenoiseEvent) {
		if (notificationPermission !== 'granted') return;
		try { new Notification('Processing Complete', { body: `${ev.dngCount} DNGs ready.` }); } catch {}
	}

	async function requestPermission() {
		if ('Notification' in window) notificationPermission = await Notification.requestPermission();
	}
</script>

<div class="monitor">
	<div class="mon-top">
		<div class="status" class:on={connected}>
			<span class="dot"></span>
			{connected ? 'Watching' : 'Connecting...'}
		</div>
		{#if notificationPermission === 'default'}
			<button class="btn-ghost btn-sm" onclick={requestPermission}>Enable Notifications</button>
		{:else if notificationPermission === 'granted'}
			<span class="notif-on">Notifications on</span>
		{/if}
	</div>

	<div class="counter">
		<span class="counter-num">{dngCount}</span>
		<span class="counter-label">
			DNG{dngCount !== 1 ? 's' : ''} ready
			{#if expectedTotal > 0}<span class="counter-of">of {expectedTotal}</span>{/if}
		</span>
	</div>

	{#if expectedTotal > 0}
		<div class="pbar-track"><div class="pbar-fill" class:done={progress >= 1} style="width: {progress * 100}%"></div></div>
		<div class="pbar-meta">
			<span>{Math.round(progress * 100)}%</span>
			{#if remaining > 0 && dngCount < expectedTotal}
				<span class="eta">~{formatDuration(remaining)} remaining</span>
			{/if}
		</div>
	{/if}

	{#if latestFile}
		<p class="latest">Latest: <code>{latestFile}</code></p>
	{/if}

	{#if isIdle}
		<div class="idle-notice">Processing appears complete &mdash; no new files for 5+ minutes.</div>
	{/if}

	<div class="algo-row">
		<label for="algo">Estimate for:</label>
		<select id="algo" bind:value={selectedAlgorithm}>
			<option value="DeepPRIME 3">DeepPRIME 3 (~24s/file)</option>
			<option value="DeepPRIME XD3">DeepPRIME XD3 (~54s/file)</option>
		</select>
	</div>
</div>

<style>
	.monitor {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.25rem;
	}

	.mon-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.status {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8rem;
		color: var(--text-muted);
	}
	.dot {
		width: 7px; height: 7px;
		border-radius: 50%;
		background: var(--text-muted);
		transition: all 0.2s;
	}
	.status.on .dot {
		background: var(--green);
		box-shadow: 0 0 8px var(--green-bg);
		animation: pulse 2s ease-in-out infinite;
	}
	.status.on { color: var(--green); }

	.notif-on { font-size: 0.75rem; color: var(--text-muted); }

	.counter {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin-bottom: 0.85rem;
	}
	.counter-num {
		font-size: 3rem;
		font-weight: 700;
		line-height: 1;
		letter-spacing: -0.04em;
		font-variant-numeric: tabular-nums;
		background: linear-gradient(135deg, var(--accent-light), var(--cyan));
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}
	.counter-label { font-size: 0.9rem; color: var(--text-secondary); }
	.counter-of { color: var(--text-muted); }

	.pbar-track {
		height: 5px;
		background: var(--bg-active);
		border-radius: 3px;
		overflow: hidden;
		margin-bottom: 0.4rem;
	}
	.pbar-fill {
		height: 100%;
		background: linear-gradient(90deg, var(--accent), var(--cyan));
		border-radius: 3px;
		transition: width 0.3s ease;
		box-shadow: 0 0 10px var(--accent-glow);
	}
	.pbar-fill.done {
		background: var(--green);
		box-shadow: 0 0 10px var(--green-bg);
	}

	.pbar-meta {
		display: flex;
		justify-content: space-between;
		font-size: 0.8rem;
		color: var(--text-muted);
		margin-bottom: 0.75rem;
	}
	.eta { color: var(--text-secondary); }

	.latest { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.6rem; }

	.idle-notice {
		background: var(--green-bg);
		border: 1px solid rgba(34, 197, 94, 0.2);
		color: var(--green);
		padding: 0.55rem 0.85rem;
		border-radius: var(--radius-sm);
		font-size: 0.8667rem;
		margin-bottom: 0.75rem;
	}

	.algo-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border);
		font-size: 0.8rem;
	}
	.algo-row label { font-size: 0.8rem; color: var(--text-muted); font-weight: 500; }
	.algo-row select { font-size: 0.8667rem; padding: 0.4rem 0.65rem; }
</style>
