<script lang="ts">
	import type { ShootDetail } from '$lib/types.js';

	let {
		shoot,
		currentView,
		onchange
	}: {
		shoot: ShootDetail;
		currentView: string;
		onchange: (view: string) => void;
	} = $props();

	const stages = [
		{ key: 'raw', label: 'Raw', count: () => shoot.rawCount },
		{ key: 'denoised', label: 'Denoised', count: () => shoot.dngCount },
		{ key: 'rate', label: 'Rate', count: () => shoot.ratedCount },
		{ key: 'selects', label: 'Selects', count: () => shoot.selectCount },
		{ key: 'export', label: 'Export', count: () => shoot.exportCount }
	];

	let furthestPopulated = $derived(
		(() => {
			let last = -1;
			stages.forEach((s, i) => {
				if (s.count() > 0) last = i;
			});
			return last;
		})()
	);
</script>

<div class="pipeline" role="tablist" aria-label="Workflow stages">
	{#each stages as stage, i (stage.key)}
		{#if i > 0}
			<div class="connector" class:filled={i <= furthestPopulated}></div>
		{/if}
		<button
			type="button"
			role="tab"
			class="stage"
			class:active={currentView === stage.key}
			class:populated={stage.count() > 0}
			aria-selected={currentView === stage.key}
			onclick={() => onchange(stage.key)}
		>
			<div class="stage-icon">
				{#if stage.key === 'raw'}
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
						<polyline points="17 8 12 3 7 8" />
						<line x1="12" y1="3" x2="12" y2="15" />
					</svg>
				{:else if stage.key === 'denoised'}
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path
							d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2z"
							opacity="0.4"
						/>
						<path d="M5 3v4M3 5h4M6 17v4M4 19h4M19 3v3M17 5h4" />
					</svg>
				{:else if stage.key === 'rate'}
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path
							d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
						/>
					</svg>
				{:else if stage.key === 'selects'}
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
						<polyline points="22 4 12 14.01 9 11.01" />
					</svg>
				{:else}
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
						<circle cx="8.5" cy="8.5" r="1.5" />
						<polyline points="21 15 16 10 5 21" />
					</svg>
				{/if}
			</div>
			<span class="stage-label">{stage.label}</span>
			{#if stage.count() > 0}
				<span class="stage-count">{stage.count()}</span>
			{/if}
		</button>
	{/each}
</div>

<style>
	.pipeline {
		display: flex;
		align-items: center;
		gap: 0;
		padding: 0.75rem 0;
		margin-bottom: 1.5rem;
		border-bottom: 1px solid var(--border);
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
		scrollbar-width: none;
	}

	.pipeline::-webkit-scrollbar {
		display: none;
	}

	.connector {
		flex: 1;
		min-width: 16px;
		max-width: 64px;
		height: 1px;
		background: var(--border-strong);
		transition: background 0.3s;
	}

	.connector.filled {
		background: var(--accent);
		opacity: 0.5;
	}

	.stage {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 0.7rem;
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--text-muted);
		font-size: 0.8rem;
		font-weight: 500;
		white-space: nowrap;
		cursor: pointer;
		transition: all 0.15s;
		position: relative;
	}

	.stage::after {
		content: '';
		position: absolute;
		bottom: -0.75rem;
		left: 0.5rem;
		right: 0.5rem;
		height: 2px;
		background: transparent;
		border-radius: 1px;
		transition: background 0.15s;
	}

	.stage:hover {
		color: var(--text-secondary);
		background: var(--bg-hover);
	}

	.stage.populated {
		color: var(--text-secondary);
	}

	.stage.active {
		color: var(--text);
	}

	.stage.active::after {
		background: var(--accent);
	}

	.stage.active .stage-icon {
		color: var(--accent-light);
	}

	.stage-icon {
		display: flex;
		flex-shrink: 0;
		transition: color 0.15s;
	}

	.stage-icon svg {
		width: 16px;
		height: 16px;
	}

	.stage-label {
		letter-spacing: -0.01em;
	}

	.stage-count {
		font-size: 0.7rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
		background: var(--bg-active);
		padding: 0.05rem 0.35rem;
		border-radius: var(--radius-full);
		line-height: 1.4;
	}

	.stage.active .stage-count {
		color: var(--accent-light);
		background: var(--accent-glow);
	}
</style>
