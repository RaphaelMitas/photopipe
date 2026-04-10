<script lang="ts">
	import type { ShootSummary } from '$lib/types.js';
	import { formatBytes, formatDate } from '$lib/utils.js';

	let { shoot }: { shoot: ShootSummary } = $props();
</script>

<a href="/shoot/{encodeURIComponent(shoot.folderName)}" class="card">
	<div class="card-top">
		<h3>{shoot.name}</h3>
		<span class="badge badge-{shoot.status}">{shoot.status}</span>
	</div>

	<time>{formatDate(shoot.date)}</time>

	<div class="card-stats">
		{#if shoot.rawCount > 0}
			<div class="stat">
				<span class="val">{shoot.rawCount}</span>
				<span class="key">RAW</span>
			</div>
		{/if}
		<div class="stat">
			<span class="val">{shoot.dngCount}</span>
			<span class="key">DNG</span>
		</div>
		<div class="stat">
			<span class="val">{shoot.exportCount}</span>
			<span class="key">Export</span>
		</div>
		<div class="stat stat-push">
			<span class="val">{formatBytes(shoot.totalSizeBytes)}</span>
			<span class="key">Size</span>
		</div>
	</div>
</a>

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.25rem;
		color: var(--text);
		transition: all 0.2s ease;
	}

	.card:hover {
		background: var(--bg-elevated);
		border-color: var(--border-strong);
		box-shadow:
			0 4px 24px rgba(0, 0, 0, 0.3),
			0 0 0 1px var(--border-strong);
		transform: translateY(-2px);
		text-decoration: none;
	}

	.card-top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	h3 {
		font-size: 1rem;
		font-weight: 600;
		letter-spacing: -0.01em;
		line-height: 1.3;
	}

	time {
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	.card-stats {
		display: flex;
		gap: 1.25rem;
		margin-top: 0.85rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border);
	}

	.stat {
		display: flex;
		flex-direction: column;
	}

	.stat-push {
		margin-left: auto;
	}

	.val {
		font-size: 1.05rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		line-height: 1.2;
	}

	.key {
		font-size: 0.7rem;
		color: var(--text-muted);
	}
</style>
