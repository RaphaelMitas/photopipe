<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { ExposureRenderer, type AdjustmentParams } from '$lib/webgl/exposure-renderer.js';

	let {
		src,
		alt,
		adjustments,
		class: className = ''
	}: {
		src: string;
		alt: string;
		adjustments: AdjustmentParams;
		class?: string;
	} = $props();

	let canvasEl: HTMLCanvasElement | undefined = $state();
	let renderer: ExposureRenderer | null = $state(null);
	let fallback = $state(false);
	let currentSrc = $state('');

	onMount(() => {
		if (!canvasEl) return;
		try {
			renderer = new ExposureRenderer(canvasEl);
		} catch {
			fallback = true;
		}
	});

	onDestroy(() => {
		renderer?.destroy();
	});

	$effect(() => {
		if (!renderer || !src) return;
		if (src === currentSrc) return;

		const img = new Image();
		img.crossOrigin = 'anonymous';
		const target = src;
		img.onload = () => {
			if (target !== src) return;
			renderer?.loadImage(img);
			renderer?.render(adjustments);
			currentSrc = target;
		};
		img.src = target;
	});

	$effect(() => {
		if (!renderer || !currentSrc) return;
		renderer.render(adjustments);
	});
</script>

{#if fallback}
	<img
		{src}
		{alt}
		class={className}
		draggable="false"
		style:filter={adjustments.exposure !== 0
			? `brightness(${Math.pow(2, adjustments.exposure)})`
			: undefined}
	/>
{:else}
	<canvas
		bind:this={canvasEl}
		class={className}
		draggable="false"
		aria-label={alt}
	></canvas>
{/if}
