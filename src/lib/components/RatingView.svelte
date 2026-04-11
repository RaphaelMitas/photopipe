<script lang="ts">
	import { onMount } from 'svelte';
	import type { FileInfo, StarRating } from '$lib/types.js';
	import StarRatingWidget from './StarRating.svelte';

	let {
		shootName,
		files,
		existingRatings,
		onclose,
		onsave
	}: {
		shootName: string;
		files: FileInfo[];
		existingRatings: Record<string, StarRating>;
		onclose: () => void;
		onsave: (ratings: Array<{ file: string; rating: StarRating }>) => void;
	} = $props();

	let currentIndex = $state(0);
	let pendingRatings = $state<Map<string, StarRating>>(new Map());
	let saving = $state(false);
	let zoomed = $state(false);
	let filmstripEl: HTMLDivElement | undefined = $state();
	let previewAreaEl: HTMLDivElement | undefined = $state();

	let currentFile = $derived(files[currentIndex]);
	let currentRating = $derived<StarRating | null>(
		pendingRatings.get(currentFile?.name ?? '') ??
			existingRatings[currentFile?.name ?? ''] ??
			null
	);
	let ratedCount = $derived(
		files.filter(
			(f) => pendingRatings.has(f.name) || existingRatings[f.name] !== undefined
		).length
	);
	let hasPending = $derived(pendingRatings.size > 0);

	function setRating(rating: StarRating) {
		if (!currentFile) return;
		pendingRatings.set(currentFile.name, rating);
		pendingRatings = new Map(pendingRatings);
	}

	function goTo(index: number) {
		currentIndex = Math.max(0, Math.min(files.length - 1, index));
		zoomed = false;
		scrollFilmstrip();
	}

	function goPrev() {
		goTo(currentIndex - 1);
	}

	function goNext() {
		goTo(currentIndex + 1);
	}

	function scrollFilmstrip() {
		if (!filmstripEl) return;
		const thumb = filmstripEl.children[currentIndex] as HTMLElement | undefined;
		thumb?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
	}

	function handleSave() {
		if (pendingRatings.size === 0) {
			onclose();
			return;
		}
		saving = true;
		const ratings = Array.from(pendingRatings.entries()).map(([file, rating]) => ({
			file,
			rating
		}));
		onsave(ratings);
	}

	function toggleZoom(e: MouseEvent) {
		if (!zoomed) {
			zoomed = true;
			requestAnimationFrame(() => {
				if (!previewAreaEl) return;
				const rect = previewAreaEl.getBoundingClientRect();
				const clickX = (e.clientX - rect.left) / rect.width;
				const clickY = (e.clientY - rect.top) / rect.height;
				previewAreaEl.scrollLeft =
					(previewAreaEl.scrollWidth - rect.width) * clickX;
				previewAreaEl.scrollTop =
					(previewAreaEl.scrollHeight - rect.height) * clickY;
			});
		} else {
			zoomed = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (zoomed) {
				zoomed = false;
				e.stopPropagation();
				return;
			}
			onclose();
			return;
		}
		if (e.key === 'z' || e.key === ' ') {
			e.preventDefault();
			zoomed = !zoomed;
			return;
		}
		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			goPrev();
			return;
		}
		if (e.key === 'ArrowRight') {
			e.preventDefault();
			goNext();
			return;
		}
		const num = parseInt(e.key);
		if (num >= 1 && num <= 5) {
			e.preventDefault();
			setRating(num as StarRating);
		}
	}

	function previewUrl(fileName: string, size: 'thumb' | 'preview' = 'thumb') {
		return `/api/thumbs/${encodeURIComponent(shootName)}/${encodeURIComponent(fileName)}?folder=denoised&size=${size}`;
	}

	function getRatingForFile(fileName: string): StarRating | null {
		return pendingRatings.get(fileName) ?? existingRatings[fileName] ?? null;
	}

	onMount(() => {
		scrollFilmstrip();
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="overlay" role="dialog" aria-modal="true" aria-label="Rating view">
	<header class="toolbar">
		<div class="toolbar-left">
			<button type="button" class="btn-ghost btn-sm" onclick={onclose}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
					<line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
				</svg>
				Close
			</button>
		</div>
		<div class="toolbar-center">
			<span class="counter">{ratedCount} of {files.length} rated</span>
		</div>
		<div class="toolbar-right">
			<button
				type="button"
				class="btn-primary btn-sm"
				disabled={saving || !hasPending}
				onclick={handleSave}
			>
				{saving ? 'Saving...' : `Save ${pendingRatings.size} rating${pendingRatings.size !== 1 ? 's' : ''}`}
			</button>
		</div>
	</header>

	<div class="main-area">
		<button type="button" class="nav-btn nav-prev" onclick={goPrev} disabled={currentIndex === 0} aria-label="Previous image">
			<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
				<polyline points="15 18 9 12 15 6" />
			</svg>
		</button>

		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="preview-area"
			class:zoomed
			bind:this={previewAreaEl}
			onclick={toggleZoom}
			role="button"
			tabindex="-1"
			aria-label={zoomed ? 'Click to zoom out' : 'Click to zoom in'}
		>
			{#if currentFile}
				{#key currentFile.name}
					<img
						src={previewUrl(currentFile.name, 'preview')}
						alt={currentFile.name}
						class="preview-img"
						draggable="false"
					/>
				{/key}
			{/if}
		</div>

		<button type="button" class="nav-btn nav-next" onclick={goNext} disabled={currentIndex === files.length - 1} aria-label="Next image">
			<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
				<polyline points="9 18 15 12 9 6" />
			</svg>
		</button>
	</div>

	<div class="bottom-bar">
		<div class="rating-controls">
			{#if currentFile}
				<span class="file-name">{currentFile.name}</span>
				<StarRatingWidget value={currentRating} size="lg" onchange={setRating} />
				<span class="rating-hint">1-5 rate · arrows navigate · z zoom</span>
			{/if}
		</div>

		<div class="filmstrip-wrap">
			<div class="filmstrip" bind:this={filmstripEl}>
				{#each files as file, i (file.name)}
					<button
						type="button"
						class="film-thumb"
						class:active={i === currentIndex}
						class:rated={getRatingForFile(file.name) !== null}
						onclick={() => goTo(i)}
					>
						<img src={previewUrl(file.name)} alt="" loading="lazy" draggable="false" />
						{#if getRatingForFile(file.name)}
							<span class="film-rating">{getRatingForFile(file.name)}</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>
	</div>
</div>

<!-- Prefetch adjacent images -->
{#if files[currentIndex - 1]}
	<link rel="prefetch" href={previewUrl(files[currentIndex - 1].name, 'preview')} />
{/if}
{#if files[currentIndex + 1]}
	<link rel="prefetch" href={previewUrl(files[currentIndex + 1].name, 'preview')} />
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		background: var(--bg-root);
		display: flex;
		flex-direction: column;
	}

	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 1rem;
		border-bottom: 1px solid var(--border);
		background: rgba(9, 9, 11, 0.85);
		backdrop-filter: blur(12px);
		flex-shrink: 0;
		z-index: 10;
	}

	.toolbar-left,
	.toolbar-right {
		min-width: 140px;
	}

	.toolbar-right {
		display: flex;
		justify-content: flex-end;
	}

	.toolbar-center {
		text-align: center;
	}

	.counter {
		font-size: 0.8rem;
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}

	.main-area {
		flex: 1;
		display: flex;
		align-items: center;
		min-height: 0;
		position: relative;
	}

	.nav-btn {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		z-index: 5;
		background: rgba(17, 17, 19, 0.7);
		backdrop-filter: blur(8px);
		color: var(--text-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.75rem 0.5rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.nav-btn:hover:not(:disabled) {
		color: var(--text);
		background: var(--bg-elevated);
		border-color: var(--border-strong);
	}

	.nav-btn:disabled {
		opacity: 0.2;
		cursor: default;
	}

	.nav-prev { left: 1rem; }
	.nav-next { right: 1rem; }

	/* Preview area — fit mode */
	.preview-area {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem 4rem;
		min-height: 0;
		height: 100%;
		overflow: hidden;
		cursor: zoom-in;
	}

	.preview-img {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		border-radius: var(--radius-sm);
		transition: none;
	}

	/* Preview area — zoomed mode */
	.preview-area.zoomed {
		overflow: auto;
		cursor: zoom-out;
		align-items: flex-start;
		justify-content: flex-start;
		scrollbar-width: thin;
		scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
	}

	.preview-area.zoomed .preview-img {
		max-width: none;
		max-height: none;
		width: auto;
		height: auto;
		border-radius: 0;
	}

	.bottom-bar {
		flex-shrink: 0;
		border-top: 1px solid var(--border);
		background: var(--bg-surface);
	}

	.rating-controls {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		padding: 0.75rem 1rem;
	}

	.file-name {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--text-muted);
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.rating-hint {
		font-size: 0.7rem;
		color: var(--text-muted);
		opacity: 0.6;
	}

	.filmstrip-wrap {
		padding: 0 1rem 0.75rem;
		overflow: hidden;
	}

	.filmstrip {
		display: flex;
		gap: 4px;
		overflow-x: auto;
		padding-bottom: 4px;
		scrollbar-width: none;
		scroll-behavior: smooth;
	}

	.filmstrip::-webkit-scrollbar {
		display: none;
	}

	.film-thumb {
		flex-shrink: 0;
		width: 48px;
		height: 48px;
		border-radius: 4px;
		overflow: hidden;
		border: 2px solid transparent;
		cursor: pointer;
		position: relative;
		transition: border-color 0.15s, opacity 0.15s;
		padding: 0;
		background: var(--bg-elevated);
	}

	.film-thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.film-thumb.active {
		border-color: var(--accent);
	}

	.film-thumb:not(.active):not(.rated) {
		opacity: 0.5;
	}

	.film-thumb:hover {
		opacity: 1;
	}

	.film-rating {
		position: absolute;
		bottom: 1px;
		right: 1px;
		font-size: 0.55rem;
		font-weight: 700;
		color: var(--yellow);
		background: rgba(0, 0, 0, 0.75);
		padding: 0 3px;
		border-radius: 2px;
		line-height: 1.4;
	}
</style>
