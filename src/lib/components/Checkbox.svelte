<script lang="ts">
	let {
		checked = false,
		onchange,
		label,
		size = 'md',
		variant = 'default'
	}: {
		checked?: boolean;
		onchange?: (checked: boolean) => void;
		label?: string;
		size?: 'sm' | 'md' | 'lg';
		variant?: 'default' | 'overlay';
	} = $props();

	function handleClick() {
		onchange?.(!checked);
	}
</script>

<button
	type="button"
	class="checkbox size-{size} variant-{variant}"
	class:checked
	onclick={handleClick}
	role="checkbox"
	aria-checked={checked}
	aria-label={label}
>
	<span class="box">
		{#if checked}
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
				<polyline points="20 6 9 17 4 12" />
			</svg>
		{/if}
	</span>
	{#if label}
		<span class="label">{label}</span>
	{/if}
</button>

<style>
	.checkbox {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		border-radius: 0;
	}

	.box {
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
		border: 2px solid var(--border-strong);
		background: var(--bg-surface);
		transition: all 0.1s;
		flex-shrink: 0;
	}

	.box svg {
		color: white;
	}

	.checked .box {
		background: var(--accent);
		border-color: var(--accent);
	}

	.checkbox:hover .box {
		border-color: var(--accent-light);
	}

	/* Overlay variant — frosted glass for use on images */
	.variant-overlay .box {
		border-color: rgba(255, 255, 255, 0.4);
		background: rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(4px);
	}

	.variant-overlay.checked .box {
		background: var(--accent);
		border-color: var(--accent);
	}

	.variant-overlay:hover .box {
		border-color: rgba(255, 255, 255, 0.7);
	}

	/* Sizes */
	.size-sm .box {
		width: 14px;
		height: 14px;
	}
	.size-sm .box svg {
		width: 9px;
		height: 9px;
	}

	.size-md .box {
		width: 18px;
		height: 18px;
	}
	.size-md .box svg {
		width: 12px;
		height: 12px;
	}

	.size-lg .box {
		width: 22px;
		height: 22px;
	}
	.size-lg .box svg {
		width: 14px;
		height: 14px;
	}

	/* Label */
	.label {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--text-secondary);
		user-select: none;
	}

	.checked .label {
		color: var(--text);
	}
</style>
