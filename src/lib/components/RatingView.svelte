<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import type { FileInfo, StarRating } from '$lib/types.js';
	import StarRatingWidget from './StarRating.svelte';

	let {
		shootName,
		files,
		existingRatings,
		onclose,
		onrate,
		startIndex = 0,
		folder = 'denoised'
	}: {
		shootName: string;
		files: FileInfo[];
		existingRatings: Record<string, StarRating>;
		onclose: (allRatings: Array<{ file: string; rating: StarRating }>) => void;
		onrate: (ratings: Array<{ file: string; rating: StarRating }>) => Promise<void>;
		startIndex?: number;
		folder?: string;
	} = $props();

	let currentIndex = $state(0);
	$effect(() => {
		currentIndex = startIndex;
	});
	let pendingRatings = new SvelteMap<string, StarRating>();
	let unsaved = new SvelteMap<string, StarRating>();
	let zoomed = $state(false);
	let filmstripEl: HTMLDivElement | undefined = $state();
	let previewAreaEl: HTMLDivElement | undefined = $state();

	let saveStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let flushTimer: ReturnType<typeof setTimeout> | undefined;
	let savedFadeTimer: ReturnType<typeof setTimeout> | undefined;

	// Filter state
	let viewFilterMode = $state<'all' | 'eq' | 'gte' | 'lte' | 'unrated'>('all');
	let viewFilterValue = $state<number>(4);

	function fileRating(fileName: string): StarRating | null {
		return pendingRatings.get(fileName) ?? existingRatings[fileName] ?? null;
	}

	function matchesFilter(index: number): boolean {
		if (viewFilterMode === 'all') return true;
		const f = files[index];
		if (!f) return false;
		const r = fileRating(f.name);
		if (viewFilterMode === 'unrated') return r === null;
		if (r === null) return false;
		if (viewFilterMode === 'eq') return r === viewFilterValue;
		if (viewFilterMode === 'gte') return r >= viewFilterValue;
		return r <= viewFilterValue;
	}

	let filteredIndices = $derived(files.map((_, i) => i).filter((i) => matchesFilter(i)));

	let currentFile = $derived(files[currentIndex]);
	let currentRating = $derived<StarRating | null>(fileRating(currentFile?.name ?? ''));
	let ratedCount = $derived(
		files.filter((f) => pendingRatings.has(f.name) || existingRatings[f.name] !== undefined).length
	);

	let currentFilteredPos = $derived(filteredIndices.indexOf(currentIndex));
	let hasPrevFiltered = $derived(
		viewFilterMode === 'all' ? currentIndex > 0 : filteredIndices.some((i) => i < currentIndex)
	);
	let hasNextFiltered = $derived(
		viewFilterMode === 'all'
			? currentIndex < files.length - 1
			: filteredIndices.some((i) => i > currentIndex)
	);

	function setRating(rating: StarRating) {
		if (!currentFile) return;
		pendingRatings.set(currentFile.name, rating);
		unsaved.set(currentFile.name, rating);
		scheduleFlush();
	}

	function scheduleFlush() {
		clearTimeout(flushTimer);
		flushTimer = setTimeout(flush, 500);
	}

	async function flush() {
		clearTimeout(flushTimer);
		if (unsaved.size === 0) return;

		const batch = Array.from(unsaved.entries()).map(([file, rating]) => ({ file, rating }));
		unsaved.clear();

		saveStatus = 'saving';
		try {
			await onrate(batch);
			saveStatus = 'saved';
			clearTimeout(savedFadeTimer);
			savedFadeTimer = setTimeout(() => {
				saveStatus = 'idle';
			}, 2000);
		} catch {
			saveStatus = 'error';
		}
	}

	function goTo(index: number) {
		currentIndex = Math.max(0, Math.min(files.length - 1, index));
		zoomed = false;
		scrollFilmstrip();
	}

	function goPrev() {
		if (viewFilterMode === 'all') {
			goTo(currentIndex - 1);
		} else {
			const prev = filteredIndices.filter((i) => i < currentIndex);
			if (prev.length > 0) goTo(prev[prev.length - 1]);
		}
	}

	function goNext() {
		if (viewFilterMode === 'all') {
			goTo(currentIndex + 1);
		} else {
			const next = filteredIndices.find((i) => i > currentIndex);
			if (next !== undefined) goTo(next);
		}
	}

	function scrollFilmstrip() {
		if (!filmstripEl) return;
		const thumb = filmstripEl.children[currentIndex] as HTMLElement | undefined;
		thumb?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
	}

	async function handleClose() {
		await flush();
		const allRatings = Array.from(pendingRatings.entries()).map(([file, rating]) => ({
			file,
			rating
		}));
		onclose(allRatings);
	}

	function toggleZoom(e: MouseEvent) {
		if (!zoomed) {
			zoomed = true;
			requestAnimationFrame(() => {
				if (!previewAreaEl) return;
				const rect = previewAreaEl.getBoundingClientRect();
				const clickX = (e.clientX - rect.left) / rect.width;
				const clickY = (e.clientY - rect.top) / rect.height;
				previewAreaEl.scrollLeft = (previewAreaEl.scrollWidth - rect.width) * clickX;
				previewAreaEl.scrollTop = (previewAreaEl.scrollHeight - rect.height) * clickY;
			});
		} else {
			zoomed = false;
		}
	}

	function setViewFilter(star: number) {
		if (viewFilterMode === 'all' || viewFilterMode === 'unrated') viewFilterMode = 'gte';
		viewFilterValue = star;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (zoomed) {
				zoomed = false;
				e.stopPropagation();
				return;
			}
			handleClose();
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
		return `/api/thumbs/${encodeURIComponent(shootName)}/${encodeURIComponent(fileName)}?folder=${folder}&size=${size}`;
	}

	onMount(() => {
		scrollFilmstrip();
	});

	onDestroy(() => {
		clearTimeout(flushTimer);
		clearTimeout(savedFadeTimer);
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="overlay" role="dialog" aria-modal="true" aria-label="Rating view">
	<header class="toolbar">
		<div class="toolbar-left">
			<button type="button" class="btn-ghost btn-sm" onclick={handleClose}>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
				>
					<line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
				</svg>
				Close
			</button>
		</div>
		<div class="toolbar-center">
			<div class="toolbar-filter">
				<button
					class="vf-btn"
					class:active={viewFilterMode === 'all'}
					onclick={() => (viewFilterMode = 'all')}>All</button
				>
				<select
					class="vf-op"
					bind:value={viewFilterMode}
					onchange={() => {
						if (viewFilterMode === 'all' || viewFilterMode === 'unrated') viewFilterMode = 'gte';
					}}
				>
					<option value="gte">��</option>
					<option value="eq">=</option>
					<option value="lte">≤</option>
				</select>
				{#each [1, 2, 3, 4, 5] as star (star)}
					<button
						class="vf-btn"
						class:active={viewFilterMode !== 'all' &&
							viewFilterMode !== 'unrated' &&
							viewFilterValue === star}
						onclick={() => setViewFilter(star)}
					>
						{star}★
					</button>
				{/each}
				<button
					class="vf-btn"
					class:active={viewFilterMode === 'unrated'}
					onclick={() => (viewFilterMode = 'unrated')}>Unrated</button
				>
			</div>
			<span class="counter">
				{#if viewFilterMode !== 'all'}
					{currentFilteredPos >= 0 ? currentFilteredPos + 1 : '–'} / {filteredIndices.length} filtered
					&middot;
				{/if}
				{ratedCount} of {files.length} rated
			</span>
		</div>
		<div class="toolbar-right">
			<span class="save-status" class:saving={saveStatus === 'saving'} class:saved={saveStatus === 'saved'} class:error={saveStatus === 'error'}>
				{#if saveStatus === 'saving'}
					<span class="status-dot"></span> Saving…
				{:else if saveStatus === 'saved'}
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12" /></svg>
					Saved
				{:else if saveStatus === 'error'}
					Save failed
				{/if}
			</span>
		</div>
	</header>

	<div class="main-area">
		<button
			type="button"
			class="nav-btn nav-prev"
			onclick={goPrev}
			disabled={!hasPrevFiltered}
			aria-label="Previous image"
		>
			<svg
				width="24"
				height="24"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
			>
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

		<button
			type="button"
			class="nav-btn nav-next"
			onclick={goNext}
			disabled={!hasNextFiltered}
			aria-label="Next image"
		>
			<svg
				width="24"
				height="24"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
			>
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
						class:rated={fileRating(file.name) !== null}
						class:dimmed={viewFilterMode !== 'all' && !matchesFilter(i)}
						onclick={() => goTo(i)}
					>
						<img src={previewUrl(file.name)} alt="" loading="lazy" draggable="false" />
						{#if fileRating(file.name)}
							<span class="film-rating">{fileRating(file.name)}</span>
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
		background: var(--header-bg);
		backdrop-filter: blur(12px);
		flex-shrink: 0;
		z-index: 10;
		gap: 0.75rem;
	}

	.toolbar-left,
	.toolbar-right {
		min-width: 120px;
		flex-shrink: 0;
	}

	.toolbar-right {
		display: flex;
		justify-content: flex-end;
	}

	.save-status {
		font-size: 0.75rem;
		color: var(--text-muted);
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		transition: opacity 0.3s;
	}

	.save-status.saving {
		color: var(--accent-light);
	}

	.save-status.saved {
		color: var(--green);
	}

	.save-status.error {
		color: var(--red);
	}

	.status-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent-light);
		animation: pulse 1.5s ease-in-out infinite;
	}

	.toolbar-center {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
	}

	.toolbar-filter {
		display: flex;
		gap: 2px;
		background: var(--bg-active);
		border-radius: var(--radius-sm);
		padding: 2px;
	}

	.vf-btn {
		background: none;
		color: var(--text-muted);
		font-size: 0.7rem;
		font-weight: 500;
		padding: 0.15rem 0.4rem;
		border-radius: 4px;
		transition: all 0.15s;
		border: none;
		cursor: pointer;
		white-space: nowrap;
	}

	.vf-btn:hover {
		color: var(--text-secondary);
	}
	.vf-btn.active {
		background: var(--bg-surface);
		color: var(--text);
		box-shadow: 0 1px 2px var(--shadow-color);
	}

	.vf-op {
		font-size: 0.7rem;
		padding: 0.1rem 0.2rem;
		background: var(--bg-surface);
		border: none;
		border-radius: 4px;
		color: var(--accent-light);
		font-weight: 600;
		cursor: pointer;
		appearance: none;
		text-align: center;
		min-width: 24px;
	}

	.counter {
		font-size: 0.7rem;
		color: var(--text-muted);
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
		background: var(--nav-btn-bg);
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

	.nav-prev {
		left: 1rem;
	}
	.nav-next {
		right: 1rem;
	}

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
		scrollbar-color: var(--scrollbar-thumb-hover) transparent;
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
		transition:
			border-color 0.15s,
			opacity 0.15s;
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

	.film-thumb.dimmed {
		opacity: 0.2;
	}

	.film-thumb.dimmed.active {
		opacity: 1;
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
