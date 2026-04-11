<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import type { RatedFileInfo, FileInfo, StarRating } from '$lib/types.js';
	import StarRatingWidget from './StarRating.svelte';
	import Checkbox from './Checkbox.svelte';
	import { formatBytes } from '$lib/utils.js';

	const ALL_FOLDERS = ['raw', 'denoised', 'rated', 'selects', 'exports'] as const;

	let {
		shootName,
		files,
		folder,
		ondelete,
		onratingchange,
		selectable = false,
		onmove,
		defaultMoveTo = 'selects',
		moving = false,
		onopen
	}: {
		shootName: string;
		files: RatedFileInfo[] | FileInfo[];
		folder: 'rated' | 'selects';
		ondelete?: (file: string) => void;
		onratingchange?: (file: string, rating: StarRating) => void;
		selectable?: boolean;
		onmove?: (files: string[], to: string) => void;
		defaultMoveTo?: string;
		moving?: boolean;
		onopen?: (fileName: string) => void;
	} = $props();

	let selected = new SvelteSet<string>();
	let dropdownOpen = $state(false);

	let allSelected = $derived(files.length > 0 && files.every((f) => selected.has(f.name)));
	let selectedCount = $derived(selected.size);
	let otherFolders = $derived(ALL_FOLDERS.filter((f) => f !== folder && f !== defaultMoveTo));

	$effect(() => {
		void files;
		selected.clear();
	});

	function toggleFile(name: string) {
		if (selected.has(name)) selected.delete(name);
		else selected.add(name);
	}

	function toggleAll() {
		if (allSelected) {
			selected.clear();
		} else {
			for (const f of files) selected.add(f.name);
		}
	}

	function handleMove(to: string) {
		if (selectedCount === 0 || !onmove) return;
		dropdownOpen = false;
		onmove(Array.from(selected), to);
	}

	function handleClickOutside(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('.move-split')) {
			dropdownOpen = false;
		}
	}

	function handleThumbClick(name: string) {
		if (selectable && selectedCount > 0) {
			toggleFile(name);
		} else if (onopen) {
			onopen(name);
		}
	}

	function getRating(file: RatedFileInfo | FileInfo): StarRating | null {
		if ('rating' in file) return file.rating;
		return null;
	}
</script>

<svelte:window onclick={handleClickOutside} />

{#if files.length === 0}
	<div class="empty">
		<p class="empty-text">
			{#if folder === 'rated'}
				No rated images yet. Open the rating view to start.
			{:else}
				No selects yet. Move rated images here.
			{/if}
		</p>
	</div>
{:else}
	{#if selectable}
		<div class="select-toolbar">
			<Checkbox
				checked={allSelected}
				onchange={toggleAll}
				label={allSelected ? 'Deselect All' : 'Select All'}
				size="sm"
			/>
			{#if selectedCount > 0}
				<span class="select-count">{selectedCount} selected</span>
				{#if onmove}
					<div class="move-split">
						<button class="move-main" disabled={moving} onclick={() => handleMove(defaultMoveTo)}>
							{moving ? 'Moving...' : `Move to ${defaultMoveTo}/`}
						</button>
						<button
							class="move-caret"
							disabled={moving}
							onclick={(e) => {
								e.stopPropagation();
								dropdownOpen = !dropdownOpen;
							}}
							aria-label="More move options"
						>
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
							>
								<polyline points="6 9 12 15 18 9" />
							</svg>
						</button>
						{#if dropdownOpen}
							<div class="move-dropdown">
								{#each otherFolders as target (target)}
									<button class="move-option" onclick={() => handleMove(target)}>
										Move to {target}/
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			{/if}
		</div>
	{/if}

	<div class="gallery">
		{#each files as file (file.name)}
			<div class="thumb" class:selected={selectable && selected.has(file.name)}>
				{#if selectable}
					<div class="select-hit">
						<Checkbox
							checked={selected.has(file.name)}
							onchange={() => toggleFile(file.name)}
							variant="overlay"
						/>
					</div>
				{/if}
				<img
					src="/api/thumbs/{encodeURIComponent(shootName)}/{encodeURIComponent(
						file.name
					)}?folder={folder}"
					alt={file.name}
					loading="lazy"
					class="thumb-img"
					class:clickable={onopen || selectedCount > 0}
					onclick={() => handleThumbClick(file.name)}
					role={onopen ? 'button' : undefined}
				/>
				<div class="thumb-overlay">
					{#if getRating(file)}
						<StarRatingWidget
							value={getRating(file)}
							size="sm"
							readonly={!onratingchange}
							onchange={(r) => onratingchange?.(file.name, r)}
						/>
					{/if}
				</div>
				<div class="thumb-footer">
					<span class="thumb-name" title={file.name}>{file.name}</span>
					<span class="thumb-size">{formatBytes(file.sizeBytes)}</span>
					{#if ondelete}
						<button class="thumb-delete" onclick={() => ondelete?.(file.name)} title="Delete"
							>&times;</button
						>
					{/if}
				</div>
			</div>
		{/each}
	</div>
{/if}

<style>
	.empty {
		padding: 2.5rem 1rem;
		text-align: center;
	}

	.empty-text {
		font-size: 0.8667rem;
		color: var(--text-muted);
	}

	/* Selection toolbar */
	.select-toolbar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		margin-bottom: 0.75rem;
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.select-count {
		font-size: 0.75rem;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
		margin-left: auto;
	}

	/* Split move button */
	.move-split {
		display: flex;
		position: relative;
	}

	.move-main {
		background: var(--accent);
		color: white;
		font-size: 0.8rem;
		font-weight: 500;
		padding: 0.3rem 0.65rem;
		border: none;
		border-radius: var(--radius-sm) 0 0 var(--radius-sm);
		cursor: pointer;
		transition: background 0.15s;
		white-space: nowrap;
	}

	.move-main:hover:not(:disabled) {
		background: var(--accent-light);
	}

	.move-main:disabled {
		opacity: 0.5;
		cursor: wait;
	}

	.move-caret {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--accent);
		color: white;
		border: none;
		border-left: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
		padding: 0.3rem 0.4rem;
		cursor: pointer;
		transition: background 0.15s;
	}

	.move-caret:hover:not(:disabled) {
		background: var(--accent-light);
	}

	.move-caret:disabled {
		opacity: 0.5;
	}

	.move-dropdown {
		position: absolute;
		top: 100%;
		right: 0;
		margin-top: 4px;
		background: var(--bg-elevated);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		z-index: 20;
		min-width: 160px;
		padding: 4px;
	}

	.move-option {
		display: block;
		width: 100%;
		text-align: left;
		background: none;
		color: var(--text-secondary);
		font-size: 0.8rem;
		padding: 0.4rem 0.65rem;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.1s;
		white-space: nowrap;
	}

	.move-option:hover {
		background: var(--bg-hover);
		color: var(--text);
	}

	/* Gallery */
	.gallery {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 0.5rem;
	}

	.thumb {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		overflow: hidden;
		transition:
			border-color 0.15s,
			transform 0.15s,
			box-shadow 0.15s;
		position: relative;
	}

	.thumb:hover {
		border-color: var(--border-strong);
		transform: translateY(-2px);
	}

	.thumb.selected {
		border-color: var(--accent);
		box-shadow:
			0 0 0 1px var(--accent),
			0 2px 8px var(--accent-glow);
	}

	.thumb-img {
		width: 100%;
		aspect-ratio: 1;
		object-fit: cover;
		display: block;
		background: var(--bg-elevated);
	}

	.thumb-img.clickable {
		cursor: pointer;
	}

	.select-hit {
		position: absolute;
		top: 0.35rem;
		right: 0.35rem;
		z-index: 3;
	}

	.thumb-overlay {
		position: absolute;
		top: 0;
		left: 0;
		padding: 0.3rem 0.35rem;
		display: flex;
		pointer-events: auto;
	}

	.thumb-footer {
		display: flex;
		align-items: center;
		padding: 0.3rem 0.5rem;
		gap: 0.25rem;
	}

	.thumb-name {
		font-size: 0.65rem;
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
		flex: 1;
	}

	.thumb-size {
		font-size: 0.6rem;
		color: var(--text-muted);
		opacity: 0.6;
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
	}

	.thumb-delete {
		background: none;
		color: var(--text-muted);
		font-size: 1rem;
		line-height: 1;
		padding: 0 0.2rem;
		flex-shrink: 0;
		opacity: 0;
		transition:
			opacity 0.15s,
			color 0.15s;
		border-radius: 0;
	}

	.thumb:hover .thumb-delete {
		opacity: 1;
	}

	.thumb-delete:hover {
		color: var(--red);
	}
</style>
