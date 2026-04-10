<script lang="ts">
	import { enhance } from '$app/forms';
	import DenoiseMonitor from '$lib/components/DenoiseMonitor.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import { formatBytes, formatDate } from '$lib/utils.js';
	import { PURERAW_SETTINGS } from '$lib/types.js';
	import { invalidateAll } from '$app/navigation';

	let { data, form } = $props();

	let showCleanupDialog = $state(false);
	let cleaning = $state(false);

	async function handleCleanup() {
		cleaning = true;
		try {
			const res = await fetch(`/api/shoots/${encodeURIComponent(data.shoot.folderName)}/cleanup`, { method: 'DELETE' });
			if (res.ok) { showCleanupDialog = false; await invalidateAll(); }
		} finally { cleaning = false; }
	}
</script>

<div class="page">
	<a href="/" class="back">
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
		Back
	</a>

	<div class="header">
		<div>
			<h1>{data.shoot.name}</h1>
			<p class="meta">
				{formatDate(data.shoot.date)}
				<span class="sep">&middot;</span>
				<span class="folder">{data.shoot.folderName}</span>
			</p>
		</div>
		<span class="badge badge-{data.shoot.status}">{data.shoot.status}</span>
	</div>

	<!-- Stats -->
	<div class="stats">
		{#if data.shoot.rawCount > 0}
			<div class="st">
				<span class="st-val">{data.shoot.rawCount}</span>
				<span class="st-label">Raw ARWs</span>
				<span class="st-sub">{formatBytes(data.shoot.rawSizeBytes)}</span>
			</div>
		{/if}
		<div class="st">
			<span class="st-val">{data.shoot.dngCount}</span>
			<span class="st-label">Denoised</span>
			<span class="st-sub">{formatBytes(data.shoot.dngSizeBytes)}</span>
		</div>
		<div class="st">
			<span class="st-val">{data.shoot.exportCount}</span>
			<span class="st-label">Exports</span>
			<span class="st-sub">{formatBytes(data.shoot.exportSizeBytes)}</span>
		</div>
		<div class="st">
			<span class="st-val">{formatBytes(data.shoot.totalSizeBytes)}</span>
			<span class="st-label">Total</span>
		</div>
	</div>

	<!-- PureRAW -->
	{#if data.shoot.rawCount > 0 && data.instructions}
		<section class="section">
			<h2>PureRAW Instructions</h2>
			<div class="card">
				<p class="card-hint">Open PureRAW on bean.local and use these settings:</p>
				<div class="paths">
					<div class="path"><span class="path-k">Input</span><code>{data.instructions.inputPath}</code></div>
					<div class="path"><span class="path-k">Output</span><code>{data.instructions.outputPath}</code></div>
				</div>
				<div class="settings-grid">
					<div class="sg-row"><span>Algorithm (hero)</span><span class="sg-val">DeepPRIME XD3</span></div>
					<div class="sg-row"><span>Algorithm (bulk)</span><span class="sg-val">DeepPRIME 3</span></div>
					<div class="sg-row"><span>Format</span><span class="sg-val">{PURERAW_SETTINGS.outputFormat}</span></div>
					<div class="sg-row"><span>Lens sharpness</span><span class="sg-val">{PURERAW_SETTINGS.lensSharpness}</span></div>
					<div class="sg-row"><span>Optical corrections</span><span class="sg-val">{PURERAW_SETTINGS.opticalCorrections}</span></div>
					<div class="sg-row"><span>Dust removal</span><span class="sg-val">{PURERAW_SETTINGS.dustRemoval}</span></div>
				</div>
			</div>
		</section>
	{/if}

	<!-- Monitor -->
	{#if data.shoot.rawCount > 0 || data.shoot.dngCount > 0}
		<section class="section">
			<h2>Denoise Monitor</h2>
			<DenoiseMonitor
				shootName={data.shoot.folderName}
				expectedTotal={data.shoot.metadata.rawCount ?? data.shoot.rawCount}
				currentCount={data.shoot.dngCount}
				algorithm={data.shoot.metadata.algorithm}
			/>
		</section>
	{/if}

	<!-- Cleanup -->
	{#if data.shoot.rawCount > 0}
		<section class="section">
			<h2>Cleanup Raw Files</h2>
			<div class="card">
				<div class="cleanup-compare">
					<span>{data.shoot.rawCount} ARWs uploaded</span>
					<span class="arrow">&rarr;</span>
					<span>{data.shoot.dngCount} DNGs processed</span>
					{#if data.shoot.rawCount === data.shoot.dngCount}
						<span class="match-ok">&check;</span>
					{:else if data.shoot.dngCount > 0}
						<span class="match-warn">mismatch</span>
					{/if}
				</div>
				<p class="card-hint">Delete raw ARWs to free <strong>{formatBytes(data.shoot.rawSizeBytes)}</strong></p>
				<button class="btn-danger" onclick={() => (showCleanupDialog = true)}>Delete Raw Files</button>
			</div>
		</section>
		<ConfirmDialog
			open={showCleanupDialog}
			title="Delete raw files?"
			message="This will permanently delete {data.shoot.rawCount} ARW files ({formatBytes(data.shoot.rawSizeBytes)}). This cannot be undone."
			confirmLabel={cleaning ? 'Deleting...' : 'Delete All'}
			onconfirm={handleCleanup}
			oncancel={() => (showCleanupDialog = false)}
		/>
	{/if}

	<!-- Exports Gallery -->
	{#if data.shoot.exportFiles.length > 0}
		<section class="section">
			<h2>Exports <span class="h2-count">{data.shoot.exportCount}</span></h2>
			<div class="gallery">
				{#each data.shoot.exportFiles as file (file.name)}
					<div class="thumb">
						<img src="/api/thumbs/{encodeURIComponent(data.shoot.folderName)}/{encodeURIComponent(file.name)}" alt={file.name} loading="lazy" />
						<span class="thumb-name">{file.name}</span>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- DNG Files -->
	{#if data.shoot.dngFiles.length > 0}
		<section class="section">
			<h2>Denoised Files <span class="h2-count">{data.shoot.dngCount}</span></h2>
			<div class="flist">
				{#each data.shoot.dngFiles as file (file.name)}
					<div class="frow">
						<span class="fn">{file.name}</span>
						<span class="fs">{formatBytes(file.sizeBytes)}</span>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Metadata -->
	<section class="section">
		<h2>Metadata</h2>
		{#if form?.success}<div class="alert alert-success">Saved.</div>{/if}
		{#if form?.error}<div class="alert alert-error">{form.error}</div>{/if}

		<form method="POST" action="?/updateMeta" use:enhance>
			<div class="meta-fields">
				<div class="field">
					<label for="algorithm">Algorithm</label>
					<select id="algorithm" name="algorithm">
						<option value="">Not set</option>
						<option value="DeepPRIME 3" selected={data.shoot.metadata.algorithm === 'DeepPRIME 3'}>DeepPRIME 3</option>
						<option value="DeepPRIME XD3" selected={data.shoot.metadata.algorithm === 'DeepPRIME XD3'}>DeepPRIME XD3</option>
					</select>
				</div>
				<div class="field">
					<label for="notes">Notes</label>
					<textarea id="notes" name="notes" rows="3" placeholder="Low light venue, ISO 6400...">{data.shoot.metadata.notes}</textarea>
				</div>
			</div>
			<button type="submit" class="btn-primary btn-sm">Save Metadata</button>
		</form>
	</section>
</div>

<style>
	.page { max-width: 860px; }

	.back {
		display: inline-flex; align-items: center; gap: 0.25rem;
		font-size: 0.8667rem; color: var(--text-muted); margin-bottom: 2rem;
	}
	.back:hover { color: var(--text); }

	.header {
		display: flex; align-items: flex-start; justify-content: space-between;
		gap: 1rem; margin-bottom: 1.5rem;
	}
	h1 { font-size: 1.6rem; font-weight: 700; letter-spacing: -0.03em; }
	.meta { font-size: 0.8667rem; color: var(--text-muted); margin-top: 0.15rem; }
	.sep { opacity: 0.4; }
	.folder { opacity: 0.6; }

	/* Stats */
	.stats {
		display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 2.5rem;
	}
	.st {
		flex: 1; min-width: 120px;
		background: var(--bg-surface); border: 1px solid var(--border);
		border-radius: var(--radius-sm); padding: 1rem 1.15rem;
		display: flex; flex-direction: column;
	}
	.st-val {
		font-size: 1.4rem; font-weight: 700; font-variant-numeric: tabular-nums;
		letter-spacing: -0.02em; line-height: 1.1;
	}
	.st-label { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.1rem; }
	.st-sub { font-size: 0.75rem; color: var(--text-muted); opacity: 0.6; margin-top: 0.15rem; }

	/* Sections */
	.section { margin-bottom: 2.5rem; }
	h2 {
		font-size: 0.9333rem; font-weight: 600;
		padding-bottom: 0.5rem; border-bottom: 1px solid var(--border);
		margin-bottom: 1rem;
	}
	.h2-count { color: var(--text-muted); font-weight: 400; }

	.card {
		background: var(--bg-surface); border: 1px solid var(--border);
		border-radius: var(--radius); padding: 1.25rem;
	}
	.card-hint { font-size: 0.8667rem; color: var(--text-muted); margin-bottom: 1rem; }

	/* Paths */
	.paths {
		display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem;
	}
	.path { display: flex; align-items: center; gap: 0.75rem; font-size: 0.8667rem; }
	.path-k { font-size: 0.75rem; color: var(--text-muted); font-weight: 500; min-width: 3.5rem; }

	/* Settings grid */
	.settings-grid { display: flex; flex-direction: column; }
	.sg-row {
		display: flex; justify-content: space-between;
		padding: 0.45rem 0; border-bottom: 1px solid var(--border-subtle);
		font-size: 0.8667rem;
	}
	.sg-row:last-child { border-bottom: none; }
	.sg-row span:first-child { color: var(--text-muted); }
	.sg-val { font-weight: 500; }

	/* Cleanup */
	.cleanup-compare {
		display: flex; align-items: center; gap: 0.75rem;
		font-size: 0.9rem; margin-bottom: 0.75rem;
	}
	.arrow { color: var(--text-muted); opacity: 0.5; }
	.match-ok { color: var(--green); font-weight: 700; font-size: 1.1rem; }
	.match-warn {
		font-size: 0.75rem; color: var(--orange); font-weight: 500;
		background: var(--orange-bg); padding: 0.1rem 0.4rem; border-radius: var(--radius-full);
	}

	/* Gallery */
	.gallery {
		display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 0.5rem;
	}
	.thumb {
		background: var(--bg-surface); border: 1px solid var(--border);
		border-radius: var(--radius-sm); overflow: hidden;
		transition: border-color 0.15s, transform 0.15s;
	}
	.thumb:hover { border-color: var(--border-strong); transform: translateY(-2px); }
	.thumb img {
		width: 100%; aspect-ratio: 1; object-fit: cover;
		display: block; background: var(--bg-elevated);
	}
	.thumb-name {
		display: block; padding: 0.3rem 0.5rem;
		font-size: 0.7rem; color: var(--text-muted);
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}

	/* File list */
	.flist {
		background: var(--bg-surface); border: 1px solid var(--border);
		border-radius: var(--radius-sm); max-height: 350px; overflow-y: auto;
	}
	.frow {
		display: flex; justify-content: space-between;
		padding: 0.4rem 0.85rem; font-size: 0.8rem;
		border-bottom: 1px solid var(--border-subtle);
	}
	.frow:last-child { border-bottom: none; }
	.fn { font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-secondary); }
	.fs { color: var(--text-muted); font-variant-numeric: tabular-nums; }

	/* Metadata */
	.meta-fields { display: flex; flex-direction: column; gap: 0.85rem; margin-bottom: 1rem; }
	.field { display: flex; flex-direction: column; gap: 0.35rem; max-width: 380px; }
	select, textarea { width: 100%; }

</style>
