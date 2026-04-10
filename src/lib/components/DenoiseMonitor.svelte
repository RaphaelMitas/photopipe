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

	// Sync prop values reactively
	$effect(() => {
		dngCount = currentCount;
	});
	$effect(() => {
		selectedAlgorithm = algorithm ?? 'DeepPRIME 3';
	});

	let progress = $derived(expectedTotal > 0 ? Math.min(dngCount / expectedTotal, 1) : 0);
	let remaining = $derived(
		expectedTotal > 0
			? Math.max(0, expectedTotal - dngCount) * DENOISE_TIMES[selectedAlgorithm]
			: 0
	);

	let notificationPermission = $state<NotificationPermission>('default');

	onMount(() => {
		if ('Notification' in window) {
			notificationPermission = Notification.permission;
		}

		const encodedName = encodeURIComponent(shootName);
		const eventSource = new EventSource(`/api/watch/${encodedName}`);

		eventSource.onopen = () => {
			connected = true;
		};

		eventSource.onmessage = (e) => {
			try {
				const event: DenoiseEvent = JSON.parse(e.data);

				dngCount = event.dngCount;
				latestFile = event.latestFile;

				if (event.type === 'idle') {
					isIdle = true;
					sendNotification(event);
				} else {
					isIdle = false;
				}
			} catch {
				// Invalid JSON
			}
		};

		eventSource.onerror = () => {
			connected = false;
		};

		return () => {
			eventSource.close();
		};
	});

	function sendNotification(event: DenoiseEvent) {
		if (notificationPermission !== 'granted') return;
		try {
			new Notification('Denoising Complete', {
				body: `${event.dngCount} DNGs processed. No new files for ${event.idleMinutes ?? 5} minutes.`,
				icon: '/favicon.png'
			});
		} catch {
			// Notifications not supported
		}
	}

	async function requestPermission() {
		if ('Notification' in window) {
			notificationPermission = await Notification.requestPermission();
		}
	}
</script>

<div class="monitor">
	<div class="monitor-header">
		<div class="connection" class:active={connected}>
			<span class="dot"></span>
			{connected ? 'Watching' : 'Connecting...'}
		</div>

		{#if notificationPermission === 'default'}
			<button class="btn-ghost notify-btn" onclick={requestPermission}>
				Enable notifications
			</button>
		{:else if notificationPermission === 'granted'}
			<span class="notify-status">Notifications on</span>
		{/if}
	</div>

	<div class="count-row">
		<span class="big-count">{dngCount}</span>
		<span class="count-label">
			DNG{dngCount !== 1 ? 's' : ''} ready
			{#if expectedTotal > 0}
				<span class="of-total">of {expectedTotal}</span>
			{/if}
		</span>
	</div>

	{#if expectedTotal > 0}
		<div class="progress-bar">
			<div class="progress-fill" style="width: {progress * 100}%"></div>
		</div>
		<div class="progress-info">
			<span>{Math.round(progress * 100)}%</span>
			{#if remaining > 0 && dngCount < expectedTotal}
				<span class="eta">~{formatDuration(remaining)} remaining</span>
			{/if}
		</div>
	{/if}

	{#if latestFile}
		<div class="latest">
			Latest: <code>{latestFile}</code>
		</div>
	{/if}

	{#if isIdle}
		<div class="idle-notice">
			No new files for 5+ minutes — denoising may be complete.
		</div>
	{/if}

	<div class="algo-selector">
		<label for="algo-select">Time estimate for:</label>
		<select id="algo-select" bind:value={selectedAlgorithm}>
			<option value="DeepPRIME 3">DeepPRIME 3 (~24s/file)</option>
			<option value="DeepPRIME XD3">DeepPRIME XD3 (~54s/file)</option>
		</select>
	</div>
</div>

<style>
	.monitor {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.25rem;
	}

	.monitor-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.connection {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	.connection .dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--text-muted);
	}

	.connection.active .dot {
		background: var(--success);
		animation: pulse 2s ease-in-out infinite;
	}

	.connection.active {
		color: var(--success);
	}

	.notify-btn {
		font-size: 0.75rem;
		padding: 0.25rem 0.5rem;
	}

	.notify-status {
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	.count-row {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.big-count {
		font-size: 2.5rem;
		font-weight: 700;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}

	.count-label {
		font-size: 0.95rem;
		color: var(--text-secondary);
	}

	.of-total {
		color: var(--text-muted);
	}

	.progress-bar {
		height: 6px;
		background: var(--bg-tertiary);
		border-radius: 3px;
		overflow: hidden;
		margin-bottom: 0.35rem;
	}

	.progress-fill {
		height: 100%;
		background: var(--accent);
		border-radius: 3px;
		transition: width 0.3s ease;
	}

	.progress-info {
		display: flex;
		justify-content: space-between;
		font-size: 0.8rem;
		color: var(--text-muted);
		margin-bottom: 0.75rem;
	}

	.eta {
		color: var(--text-secondary);
	}

	.latest {
		font-size: 0.8rem;
		color: var(--text-muted);
		margin-bottom: 0.75rem;
	}

	.idle-notice {
		background: rgba(34, 197, 94, 0.1);
		border: 1px solid rgba(34, 197, 94, 0.25);
		color: var(--success);
		padding: 0.6rem 0.75rem;
		border-radius: var(--radius);
		font-size: 0.85rem;
		margin-bottom: 0.75rem;
	}

	.algo-selector {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	.algo-selector select {
		font-size: 0.8rem;
		padding: 0.25rem 0.5rem;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.4;
		}
	}
</style>
