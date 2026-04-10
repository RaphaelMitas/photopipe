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
			const res = await fetch(
				`/api/shoots/${encodeURIComponent(data.shoot.folderName)}/cleanup`,
				{ method: 'DELETE' }
			);
			if (res.ok) {
				showCleanupDialog = false;
				await invalidateAll();
			}
		} finally {
			cleaning = false;
		}
	}
</script>

<div class="page">
	<a href="/" class="back">&larr; Dashboard</a>

	<div class="shoot-header">
		<div>
			<h1>{data.shoot.name}</h1>
			<time>{formatDate(data.shoot.date)}</time>
		</div>
		<span class="badge badge-{data.shoot.status}">{data.shoot.status}</span>
	</div>

	<!-- Stats overview -->
	<div class="stats-row">
		{#if data.shoot.rawCount > 0}
			<div class="stat-card">
				<span class="stat-value">{data.shoot.rawCount}</span>
				<span class="stat-label">Raw ARWs</span>
				<span class="stat-detail">{formatBytes(data.shoot.rawSizeBytes)}</span>
			</div>
		{/if}
		<div class="stat-card">
			<span class="stat-value">{data.shoot.dngCount}</span>
			<span class="stat-label">Denoised DNGs</span>
			<span class="stat-detail">{formatBytes(data.shoot.dngSizeBytes)}</span>
		</div>
		<div class="stat-card">
			<span class="stat-value">{data.shoot.exportCount}</span>
			<span class="stat-label">Exports</span>
			<span class="stat-detail">{formatBytes(data.shoot.exportSizeBytes)}</span>
		</div>
		<div class="stat-card">
			<span class="stat-value">{formatBytes(data.shoot.totalSizeBytes)}</span>
			<span class="stat-label">Total Size</span>
		</div>
	</div>

	<!-- PureRAW instructions (shown when raw files exist) -->
	{#if data.shoot.rawCount > 0 && data.instructions}
		<section class="section">
			<h2>PureRAW Instructions</h2>
			<div class="pureraw-instructions">
				<p class="instruction-hint">Open PureRAW on bean.local and use these settings:</p>
				<div class="instruction-paths">
					<div class="path-row">
						<span class="path-label">Input:</span>
						<code>{data.instructions.inputPath}</code>
					</div>
					<div class="path-row">
						<span class="path-label">Output:</span>
						<code>{data.instructions.outputPath}</code>
					</div>
				</div>
				<table class="settings-table">
					<tbody>
						<tr>
							<td>Algorithm (hero shots)</td>
							<td>DeepPRIME XD3</td>
						</tr>
						<tr>
							<td>Algorithm (bulk)</td>
							<td>DeepPRIME 3</td>
						</tr>
						<tr>
							<td>Output format</td>
							<td>{PURERAW_SETTINGS.outputFormat}</td>
						</tr>
						<tr>
							<td>Lens sharpness</td>
							<td>{PURERAW_SETTINGS.lensSharpness}</td>
						</tr>
						<tr>
							<td>Optical corrections</td>
							<td>{PURERAW_SETTINGS.opticalCorrections}</td>
						</tr>
						<tr>
							<td>Dust removal</td>
							<td>{PURERAW_SETTINGS.dustRemoval}</td>
						</tr>
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	<!-- Denoise Monitor -->
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

	<!-- Cleanup raw files -->
	{#if data.shoot.rawCount > 0}
		<section class="section">
			<h2>Cleanup Raw Files</h2>
			<div class="cleanup-info">
				<div class="cleanup-comparison">
					<span>{data.shoot.rawCount} ARWs uploaded</span>
					<span class="arrow">&rarr;</span>
					<span>{data.shoot.dngCount} DNGs processed</span>
					{#if data.shoot.rawCount === data.shoot.dngCount}
						<span class="match">&#10003;</span>
					{:else if data.shoot.dngCount > 0}
						<span class="mismatch">mismatch</span>
					{/if}
				</div>
				<p class="cleanup-detail">
					Will free <strong>{formatBytes(data.shoot.rawSizeBytes)}</strong> by deleting all ARW files
					from <code>raw/</code>.
				</p>
				<button class="btn-danger" onclick={() => (showCleanupDialog = true)}>
					Delete Raw Files
				</button>
			</div>
		</section>

		<ConfirmDialog
			open={showCleanupDialog}
			title="Delete raw files?"
			message="This will permanently delete {data.shoot.rawCount} ARW files ({formatBytes(data.shoot.rawSizeBytes)}) from this shoot's raw/ folder. This cannot be undone."
			confirmLabel={cleaning ? 'Deleting...' : 'Delete All'}
			onconfirm={handleCleanup}
			oncancel={() => (showCleanupDialog = false)}
		/>
	{/if}

	<!-- Export gallery -->
	{#if data.shoot.exportFiles.length > 0}
		<section class="section">
			<h2>Exports ({data.shoot.exportCount})</h2>
			<div class="gallery">
				{#each data.shoot.exportFiles as file (file.name)}
					<div class="thumb-card">
						<img
							src="/api/thumbs/{encodeURIComponent(data.shoot.folderName)}/{encodeURIComponent(file.name)}"
							alt={file.name}
							loading="lazy"
						/>
						<span class="thumb-name">{file.name}</span>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- DNG file list -->
	{#if data.shoot.dngFiles.length > 0}
		<section class="section">
			<h2>Denoised Files ({data.shoot.dngCount})</h2>
			<div class="file-list">
				{#each data.shoot.dngFiles as file (file.name)}
					<div class="file-row">
						<span class="file-name">{file.name}</span>
						<span class="file-size">{formatBytes(file.sizeBytes)}</span>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Metadata editor -->
	<section class="section">
		<h2>Metadata</h2>

		{#if form?.success}
			<div class="success-msg">Metadata saved.</div>
		{/if}
		{#if form?.error}
			<div class="error-msg">{form.error}</div>
		{/if}

		<form method="POST" action="?/updateMeta" use:enhance>
			<div class="meta-fields">
				<div class="field">
					<label for="algorithm">Algorithm</label>
					<select id="algorithm" name="algorithm">
						<option value="">Not set</option>
						<option value="DeepPRIME 3" selected={data.shoot.metadata.algorithm === 'DeepPRIME 3'}>
							DeepPRIME 3
						</option>
						<option
							value="DeepPRIME XD3"
							selected={data.shoot.metadata.algorithm === 'DeepPRIME XD3'}
						>
							DeepPRIME XD3
						</option>
					</select>
				</div>
				<div class="field">
					<label for="notes">Notes</label>
					<textarea id="notes" name="notes" rows="3" placeholder="e.g. Low light venue, ISO 6400"
						>{data.shoot.metadata.notes}</textarea
					>
				</div>
			</div>
			<button type="submit" class="btn-ghost">Save Metadata</button>
		</form>
	</section>
</div>

<style>
	.page {
		max-width: 900px;
	}

	.back {
		font-size: 0.85rem;
		color: var(--text-muted);
		display: inline-block;
		margin-bottom: 1.5rem;
	}

	.back:hover {
		color: var(--text-primary);
		text-decoration: none;
	}

	.shoot-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	h1 {
		font-size: 1.5rem;
		font-weight: 700;
	}

	time {
		font-size: 0.85rem;
		color: var(--text-muted);
	}

	.stats-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 0.75rem;
		margin-bottom: 2rem;
	}

	.stat-card {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1rem;
		display: flex;
		flex-direction: column;
	}

	.stat-value {
		font-size: 1.5rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.stat-label {
		font-size: 0.75rem;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.stat-detail {
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin-top: 0.25rem;
	}

	.section {
		margin-bottom: 2.5rem;
	}

	h2 {
		font-size: 1.1rem;
		font-weight: 600;
		margin-bottom: 1rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--border);
	}

	/* PureRAW */
	.pureraw-instructions {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.25rem;
	}

	.instruction-hint {
		font-size: 0.875rem;
		color: var(--text-secondary);
		margin-bottom: 1rem;
	}

	.instruction-paths {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.path-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
	}

	.path-label {
		color: var(--text-muted);
		min-width: 4rem;
		font-weight: 500;
	}

	.settings-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}

	.settings-table td {
		padding: 0.4rem 0;
		border-bottom: 1px solid var(--border);
	}

	.settings-table td:first-child {
		color: var(--text-secondary);
		width: 45%;
	}

	.settings-table td:last-child {
		font-weight: 500;
	}

	/* Cleanup */
	.cleanup-info {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.25rem;
	}

	.cleanup-comparison {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.95rem;
		margin-bottom: 0.75rem;
	}

	.arrow {
		color: var(--text-muted);
	}

	.match {
		color: var(--success);
		font-weight: 700;
	}

	.mismatch {
		color: var(--warning);
		font-size: 0.8rem;
		font-weight: 500;
	}

	.cleanup-detail {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin-bottom: 1rem;
	}

	/* Gallery */
	.gallery {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 0.75rem;
	}

	.thumb-card {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
	}

	.thumb-card img {
		width: 100%;
		aspect-ratio: 1;
		object-fit: cover;
		display: block;
		background: var(--bg-tertiary);
	}

	.thumb-name {
		display: block;
		padding: 0.35rem 0.5rem;
		font-size: 0.7rem;
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* File list */
	.file-list {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		max-height: 400px;
		overflow-y: auto;
	}

	.file-row {
		display: flex;
		justify-content: space-between;
		padding: 0.5rem 1rem;
		font-size: 0.85rem;
		border-bottom: 1px solid var(--border);
	}

	.file-row:last-child {
		border-bottom: none;
	}

	.file-name {
		font-family: var(--font-mono);
		font-size: 0.8rem;
	}

	.file-size {
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}

	/* Metadata */
	.meta-fields {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	label {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--text-secondary);
	}

	select,
	textarea {
		width: 100%;
		max-width: 400px;
	}

	.success-msg {
		background: rgba(34, 197, 94, 0.1);
		border: 1px solid rgba(34, 197, 94, 0.3);
		color: var(--success);
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius);
		margin-bottom: 1rem;
		font-size: 0.85rem;
	}

	.error-msg {
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.3);
		color: var(--danger);
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius);
		margin-bottom: 1rem;
		font-size: 0.85rem;
	}
</style>
