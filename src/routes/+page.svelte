<script lang="ts">
	import ShootCard from '$lib/components/ShootCard.svelte';

	let { data } = $props();
</script>

<div class="dashboard">
	<div class="header">
		<div>
			<h1>Shoots</h1>
			<p class="subtitle">{data.shoots.length} shoot{data.shoots.length !== 1 ? 's' : ''}</p>
		</div>
	</div>

	{#if data.shoots.length === 0}
		<div class="empty">
			<p>No shoots yet</p>
			<p class="hint">Create your first shoot to get started.</p>
			<a href="/new" class="btn-primary">New Shoot</a>
		</div>
	{:else}
		<div class="grid">
			{#each data.shoots as shoot (shoot.folderName)}
				<ShootCard {shoot} />
			{/each}
		</div>
	{/if}
</div>

<style>
	.dashboard {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	h1 {
		font-size: 1.75rem;
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	.subtitle {
		color: var(--text-muted);
		font-size: 0.875rem;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 1rem;
	}

	.empty {
		text-align: center;
		padding: 4rem 2rem;
		color: var(--text-secondary);
	}

	.empty p {
		font-size: 1.125rem;
	}

	.empty .hint {
		font-size: 0.875rem;
		color: var(--text-muted);
		margin-top: 0.25rem;
		margin-bottom: 1.5rem;
	}
</style>
