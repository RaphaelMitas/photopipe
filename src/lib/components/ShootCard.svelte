<script lang="ts">
	import type { ShootSummary } from '$lib/types.js';
	import { formatBytes, formatDate } from '$lib/utils.js';

	let { shoot }: { shoot: ShootSummary } = $props();
</script>

<a href="/shoot/{encodeURIComponent(shoot.folderName)}" class="card">
	<div class="card-header">
		<h3>{shoot.name}</h3>
		<span class="badge badge-{shoot.status}">{shoot.status}</span>
	</div>

	<time class="date">{formatDate(shoot.date)}</time>

	<div class="stats">
		{#if shoot.rawCount > 0}
			<div class="stat">
				<span class="stat-value">{shoot.rawCount}</span>
				<span class="stat-label">RAWs</span>
			</div>
		{/if}
		<div class="stat">
			<span class="stat-value">{shoot.dngCount}</span>
			<span class="stat-label">DNGs</span>
		</div>
		<div class="stat">
			<span class="stat-value">{shoot.exportCount}</span>
			<span class="stat-label">Exports</span>
		</div>
		<div class="stat">
			<span class="stat-value">{formatBytes(shoot.totalSizeBytes)}</span>
			<span class="stat-label">Size</span>
		</div>
	</div>
</a>

<style>
	.card {
		display: block;
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: 1.25rem;
		color: var(--text-primary);
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}

	.card:hover {
		border-color: var(--border-light);
		box-shadow: var(--shadow-lg);
		text-decoration: none;
	}

	.card-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.25rem;
	}

	h3 {
		font-size: 1rem;
		font-weight: 600;
		line-height: 1.3;
	}

	.date {
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	.stats {
		display: flex;
		gap: 1.5rem;
		margin-top: 1rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border);
	}

	.stat {
		display: flex;
		flex-direction: column;
	}

	.stat-value {
		font-size: 1.125rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.stat-label {
		font-size: 0.75rem;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
</style>
