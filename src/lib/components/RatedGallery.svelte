<script lang="ts">
	import type { RatedFileInfo, FileInfo, StarRating } from '$lib/types.js';
	import StarRatingWidget from './StarRating.svelte';
	import { formatBytes } from '$lib/utils.js';

	let {
		shootName,
		files,
		folder,
		ondelete,
		onratingchange
	}: {
		shootName: string;
		files: RatedFileInfo[] | FileInfo[];
		folder: 'rated' | 'selects';
		ondelete?: (file: string) => void;
		onratingchange?: (file: string, rating: StarRating) => void;
	} = $props();

	function getRating(file: RatedFileInfo | FileInfo): StarRating | null {
		if ('rating' in file) return file.rating;
		return null;
	}
</script>

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
	<div class="gallery">
		{#each files as file (file.name)}
			<div class="thumb">
				<img
					src="/api/thumbs/{encodeURIComponent(shootName)}/{encodeURIComponent(file.name)}?folder={folder}"
					alt={file.name}
					loading="lazy"
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
						<button
							class="thumb-delete"
							onclick={() => ondelete?.(file.name)}
							title="Delete">&times;</button
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
		transition: border-color 0.15s, transform 0.15s;
		position: relative;
	}

	.thumb:hover {
		border-color: var(--border-strong);
		transform: translateY(-2px);
	}

	.thumb img {
		width: 100%;
		aspect-ratio: 1;
		object-fit: cover;
		display: block;
		background: var(--bg-elevated);
	}

	.thumb-overlay {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		padding: 0.35rem 0.4rem;
		background: linear-gradient(to bottom, rgba(0, 0, 0, 0.6) 0%, transparent 100%);
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
		transition: opacity 0.15s, color 0.15s;
		border-radius: 0;
	}

	.thumb:hover .thumb-delete {
		opacity: 1;
	}

	.thumb-delete:hover {
		color: var(--red);
	}
</style>
