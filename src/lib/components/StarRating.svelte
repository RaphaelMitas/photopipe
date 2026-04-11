<script lang="ts">
	import type { StarRating } from '$lib/types.js';

	let {
		value,
		onchange,
		size = 'md',
		readonly = false
	}: {
		value: StarRating | null;
		onchange?: (rating: StarRating) => void;
		size?: 'sm' | 'md' | 'lg';
		readonly?: boolean;
	} = $props();

	let hoverValue = $state<number | null>(null);

	const stars = [1, 2, 3, 4, 5] as const;

	let displayValue = $derived(hoverValue ?? value ?? 0);

	function handleClick(star: StarRating) {
		if (readonly) return;
		onchange?.(star);
	}

	function handleEnter(star: number) {
		if (readonly) return;
		hoverValue = star;
	}

	function handleLeave() {
		hoverValue = null;
	}
</script>

<div
	class="stars stars-{size}"
	class:readonly
	role={readonly ? 'img' : 'radiogroup'}
	aria-label="Star rating"
	onmouseleave={handleLeave}
>
	{#each stars as star (star)}
		<button
			type="button"
			class="star"
			class:filled={star <= displayValue}
			class:hovering={hoverValue !== null && star <= (hoverValue ?? 0)}
			disabled={readonly}
			aria-label="{star} star{star !== 1 ? 's' : ''}"
			onclick={() => handleClick(star)}
			onmouseenter={() => handleEnter(star)}
		>
			<svg viewBox="0 0 24 24" fill={star <= displayValue ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.5">
				<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
			</svg>
		</button>
	{/each}
</div>

<style>
	.stars {
		display: inline-flex;
		gap: 1px;
		line-height: 1;
	}

	.star {
		background: none;
		border: none;
		padding: 0;
		color: var(--text-muted);
		cursor: pointer;
		transition: color 0.1s, transform 0.1s;
		display: flex;
		border-radius: 0;
	}

	.star:disabled {
		cursor: default;
		opacity: 1;
	}

	.star.filled {
		color: var(--yellow);
	}

	.star.hovering {
		color: var(--yellow);
		transform: scale(1.15);
	}

	.readonly .star {
		pointer-events: none;
	}

	.stars-sm svg {
		width: 14px;
		height: 14px;
	}

	.stars-md svg {
		width: 20px;
		height: 20px;
	}

	.stars-lg svg {
		width: 32px;
		height: 32px;
	}
</style>
