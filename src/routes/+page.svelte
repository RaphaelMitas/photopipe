<script lang="ts">
	import ShootCard from '$lib/components/ShootCard.svelte';

	let { data } = $props();
</script>

<div class="dashboard">
	<div class="page-header">
		<h1>Shoots</h1>
		<p class="count">{data.shoots.length} shoot{data.shoots.length !== 1 ? 's' : ''}</p>
	</div>

	{#if data.shoots.length === 0}
		<div class="empty">
			<div class="empty-ring">
				<svg
					width="48"
					height="48"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
				>
					<circle cx="12" cy="12" r="10" opacity="0.2" />
					<circle cx="12" cy="12" r="4" opacity="0.3" />
				</svg>
			</div>
			<p class="empty-title">No shoots yet</p>
			<p class="empty-sub">Create your first shoot to get started.</p>
			<a href="/new" class="btn-primary">New Shoot</a>
		</div>
	{:else}
		<div class="grid">
			{#each data.shoots as shoot, i (shoot.folderName)}
				<div class="card-anim" style="animation-delay: {i * 50}ms">
					<ShootCard {shoot} />
				</div>
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

	.page-header {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
	}

	h1 {
		font-size: 1.6rem;
		font-weight: 700;
		letter-spacing: -0.03em;
	}

	.count {
		font-size: 0.8667rem;
		color: var(--text-muted);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
		gap: 0.75rem;
	}

	.card-anim {
		animation: slide-up 0.4s ease both;
	}

	.empty {
		text-align: center;
		padding: 5rem 2rem;
	}

	.empty-ring {
		color: var(--text-muted);
		margin-bottom: 1rem;
	}

	.empty-title {
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 0.25rem;
	}

	.empty-sub {
		font-size: 0.8667rem;
		color: var(--text-muted);
		margin-bottom: 1.75rem;
	}
</style>
