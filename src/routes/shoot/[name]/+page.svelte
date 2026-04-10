<script lang="ts">
	import { enhance } from '$app/forms';
	import DenoiseMonitor from '$lib/components/DenoiseMonitor.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import DownloadDialog from '$lib/components/DownloadDialog.svelte';
	import { formatBytes, formatDate } from '$lib/utils.js';
	import { PURERAW_SETTINGS } from '$lib/types.js';
	import { goto, invalidateAll } from '$app/navigation';

	let { data, form } = $props();

	let showDownloadDialog = $state(false);

	// Delete state
	let showDeleteAllDialog = $state(false);
	let showDeleteSingleDialog = $state(false);
	let deleting = $state(false);
	let deleteTargetFile = $state<string | null>(null);
	let deleteTargetFolder = $state<'exports' | 'denoised' | 'raw'>('exports');
	let showDeleteProjectDialog = $state(false);
	let deletingProject = $state(false);

	const deleteAllTitle = $derived(
		deleteTargetFolder === 'raw'
			? 'Delete raw files?'
			: deleteTargetFolder === 'denoised'
				? 'Delete all denoised files?'
				: 'Delete all exports?'
	);
	const deleteAllMessage = $derived(
		deleteTargetFolder === 'raw'
			? `This will permanently delete ${data.shoot.rawCount} ARW file${data.shoot.rawCount !== 1 ? 's' : ''} (${formatBytes(data.shoot.rawSizeBytes)}). This cannot be undone.`
			: deleteTargetFolder === 'denoised'
				? `This will permanently delete ${data.shoot.dngCount} DNG file${data.shoot.dngCount !== 1 ? 's' : ''} (${formatBytes(data.shoot.dngSizeBytes)}). This cannot be undone.`
				: `This will permanently delete ${data.shoot.exportCount} exported file${data.shoot.exportCount !== 1 ? 's' : ''} (${formatBytes(data.shoot.exportSizeBytes)}) and their cached thumbnails. This cannot be undone.`
	);

	// Upload state
	let uploadFolder = $state<'exports' | 'denoised' | 'raw'>('exports');
	let uploadFiles = $state<File[]>([]);
	let uploading = $state(false);
	let uploadedCount = $state(0);
	let uploadTotal = $state(0);

	const UPLOAD_ACCEPT: Record<string, string> = {
		raw: '.arw,.ARW',
		denoised: '.dng,.DNG',
		exports: '.jpg,.jpeg,.png,.tif,.tiff,.webp,.dng,.JPG,.JPEG,.PNG,.TIF,.TIFF,.WEBP,.DNG'
	};

	async function handleDeleteFiles(folder: 'exports' | 'denoised' | 'raw', files?: string[]) {
		deleting = true;
		try {
			const res = await fetch(`/api/shoots/${encodeURIComponent(data.shoot.folderName)}/files`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ folder, files })
			});
			if (res.ok) {
				showDeleteAllDialog = false;
				showDeleteSingleDialog = false;
				deleteTargetFile = null;
				await invalidateAll();
			}
		} finally {
			deleting = false;
		}
	}

	async function handleDeleteProject() {
		deletingProject = true;
		try {
			const res = await fetch(`/api/shoots/${encodeURIComponent(data.shoot.folderName)}`, {
				method: 'DELETE'
			});
			if (res.ok) {
				await goto('/');
			}
		} finally {
			deletingProject = false;
		}
	}

	function requestDeleteSingle(folder: 'exports' | 'denoised' | 'raw', fileName: string) {
		deleteTargetFile = fileName;
		deleteTargetFolder = folder;
		showDeleteSingleDialog = true;
	}

	function handleUploadFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files) {
			const existing = new Set(uploadFiles.map((f) => f.name));
			const newFiles = Array.from(input.files).filter((f) => !existing.has(f.name));
			uploadFiles = [...uploadFiles, ...newFiles];
		}
	}

	function handleUploadDrop(e: DragEvent) {
		e.preventDefault();
		if (e.dataTransfer?.files) {
			const existing = new Set(uploadFiles.map((f) => f.name));
			const newFiles = Array.from(e.dataTransfer.files).filter((f) => !existing.has(f.name));
			uploadFiles = [...uploadFiles, ...newFiles];
		}
	}

	function removeUploadFile(index: number) {
		uploadFiles = uploadFiles.filter((_, i) => i !== index);
	}

	async function handleUpload() {
		if (uploadFiles.length === 0) return;
		uploading = true;
		uploadedCount = 0;
		uploadTotal = uploadFiles.length;

		const BATCH = 3;
		for (let i = 0; i < uploadFiles.length; i += BATCH) {
			const batch = uploadFiles.slice(i, i + BATCH);
			await Promise.allSettled(
				batch.map(async (file) => {
					const fd = new FormData();
					fd.append('file', file);
					fd.append('folder', uploadFolder);
					const res = await fetch(`/api/upload/${encodeURIComponent(data.shoot.folderName)}`, {
						method: 'POST',
						body: fd
					});
					if (res.ok) uploadedCount++;
				})
			);
		}

		// Finalize
		await fetch(`/api/upload/${encodeURIComponent(data.shoot.folderName)}`, { method: 'PATCH' });
		uploadFiles = [];
		uploading = false;
		uploadedCount = 0;
		uploadTotal = 0;
		await invalidateAll();
	}
</script>

<div class="page">
	<a href="/" class="back">
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"><polyline points="15 18 9 12 15 6" /></svg
		>
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
		<div class="header-actions">
			<button class="btn-ghost btn-sm" onclick={() => (showDownloadDialog = true)}>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
					<polyline points="7 10 12 15 17 10" />
					<line x1="12" y1="15" x2="12" y2="3" />
				</svg>
				Download
			</button>
			<button class="btn-danger btn-sm" onclick={() => (showDeleteProjectDialog = true)}>
				Delete Project
			</button>
			<span class="badge badge-{data.shoot.status}">{data.shoot.status}</span>
		</div>
	</div>

	<DownloadDialog
		open={showDownloadDialog}
		shoot={data.shoot}
		oncancel={() => (showDownloadDialog = false)}
	/>

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
					<div class="path">
						<span class="path-k">Input</span><code>{data.instructions.inputPath}</code>
					</div>
					<div class="path">
						<span class="path-k">Output</span><code>{data.instructions.outputPath}</code>
					</div>
				</div>
				<div class="settings-grid">
					<div class="sg-row">
						<span>Algorithm (hero)</span><span class="sg-val">DeepPRIME XD3</span>
					</div>
					<div class="sg-row">
						<span>Algorithm (bulk)</span><span class="sg-val">DeepPRIME 3</span>
					</div>
					<div class="sg-row">
						<span>Format</span><span class="sg-val">{PURERAW_SETTINGS.outputFormat}</span>
					</div>
					<div class="sg-row">
						<span>Lens sharpness</span><span class="sg-val">{PURERAW_SETTINGS.lensSharpness}</span>
					</div>
					<div class="sg-row">
						<span>Optical corrections</span><span class="sg-val"
							>{PURERAW_SETTINGS.opticalCorrections}</span
						>
					</div>
					<div class="sg-row">
						<span>Dust removal</span><span class="sg-val">{PURERAW_SETTINGS.dustRemoval}</span>
					</div>
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
				<p class="card-hint">
					Delete raw ARWs to free <strong>{formatBytes(data.shoot.rawSizeBytes)}</strong>
				</p>
				<button
					class="btn-danger"
					onclick={() => {
						deleteTargetFolder = 'raw';
						showDeleteAllDialog = true;
					}}>Delete Raw Files</button
				>
			</div>
		</section>
	{/if}

	<!-- Exports Gallery -->
	{#if data.shoot.exportFiles.length > 0}
		<section class="section">
			<div class="section-header">
				<h2>Exports <span class="h2-count">{data.shoot.exportCount}</span></h2>
				<button
					class="btn-danger btn-sm"
					onclick={() => {
						deleteTargetFolder = 'exports';
						showDeleteAllDialog = true;
					}}
				>
					Delete All
				</button>
			</div>
			<div class="gallery">
				{#each data.shoot.exportFiles as file (file.name)}
					<div class="thumb">
						<img
							src="/api/thumbs/{encodeURIComponent(data.shoot.folderName)}/{encodeURIComponent(
								file.name
							)}"
							alt={file.name}
							loading="lazy"
						/>
						<div class="thumb-footer">
							<span class="thumb-name">{file.name}</span>
							<button
								class="thumb-delete"
								onclick={() => requestDeleteSingle('exports', file.name)}
								title="Delete">&times;</button
							>
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- DNG Files -->
	{#if data.shoot.dngFiles.length > 0}
		<section class="section">
			<div class="section-header">
				<h2>Denoised Files <span class="h2-count">{data.shoot.dngCount}</span></h2>
				<button
					class="btn-danger btn-sm"
					onclick={() => {
						deleteTargetFolder = 'denoised';
						showDeleteAllDialog = true;
					}}
				>
					Delete All
				</button>
			</div>
			<div class="flist">
				{#each data.shoot.dngFiles as file (file.name)}
					<div class="frow">
						<span class="fn">{file.name}</span>
						<span class="fs">{formatBytes(file.sizeBytes)}</span>
						<button
							class="frow-delete"
							onclick={() => requestDeleteSingle('denoised', file.name)}
							title="Delete">&times;</button
						>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Delete dialogs -->
	<ConfirmDialog
		open={showDeleteAllDialog}
		title={deleteAllTitle}
		message={deleteAllMessage}
		confirmLabel={deleting ? 'Deleting...' : 'Delete All'}
		onconfirm={() => handleDeleteFiles(deleteTargetFolder)}
		oncancel={() => (showDeleteAllDialog = false)}
	/>
	<ConfirmDialog
		open={showDeleteSingleDialog}
		title="Delete file?"
		message="This will permanently delete {deleteTargetFile ?? ''}. This cannot be undone."
		confirmLabel={deleting ? 'Deleting...' : 'Delete'}
		onconfirm={() => handleDeleteFiles(deleteTargetFolder, [deleteTargetFile!])}
		oncancel={() => {
			showDeleteSingleDialog = false;
			deleteTargetFile = null;
		}}
	/>

	<ConfirmDialog
		open={showDeleteProjectDialog}
		title="Delete this project?"
		message={`This will permanently delete the entire project \u201c${data.shoot.name}\u201d including all raw files, denoised files, exports, and metadata (${formatBytes(data.shoot.totalSizeBytes)}). This cannot be undone.`}
		confirmLabel={deletingProject ? 'Deleting...' : 'Delete Project'}
		onconfirm={handleDeleteProject}
		oncancel={() => (showDeleteProjectDialog = false)}
	/>

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
						<option value="DeepPRIME 3" selected={data.shoot.metadata.algorithm === 'DeepPRIME 3'}
							>DeepPRIME 3</option
						>
						<option
							value="DeepPRIME XD3"
							selected={data.shoot.metadata.algorithm === 'DeepPRIME XD3'}>DeepPRIME XD3</option
						>
					</select>
				</div>
				<div class="field">
					<label for="notes">Notes</label>
					<textarea id="notes" name="notes" rows="3" placeholder="Low light venue, ISO 6400..."
						>{data.shoot.metadata.notes}</textarea
					>
				</div>
			</div>
			<button type="submit" class="btn-primary btn-sm">Save Metadata</button>
		</form>
	</section>

	<!-- Upload Files -->
	<section class="section">
		<h2>Upload Files</h2>
		<div class="card">
			<div class="upload-controls">
				<div class="field" style="max-width: 200px;">
					<label for="upload-folder">Target folder</label>
					<select id="upload-folder" bind:value={uploadFolder}>
						<option value="exports">Exports</option>
						<option value="denoised">Denoised</option>
						<option value="raw">Raw</option>
					</select>
				</div>
			</div>

			<div
				class="upload-drop"
				ondragover={(e) => e.preventDefault()}
				ondrop={handleUploadDrop}
				role="region"
				aria-label="Upload drop zone"
			>
				<svg
					width="24"
					height="24"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="upload-drop-icon"
				>
					<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
					<polyline points="17 8 12 3 7 8" />
					<line x1="12" y1="3" x2="12" y2="15" />
				</svg>
				<span class="upload-drop-text">Drop files or</span>
				<label class="btn-ghost btn-sm upload-browse">
					Browse
					<input
						type="file"
						accept={UPLOAD_ACCEPT[uploadFolder]}
						multiple
						onchange={handleUploadFileSelect}
						hidden
					/>
				</label>
			</div>

			{#if uploadFiles.length > 0}
				<div class="upload-file-list">
					{#each uploadFiles as file, i (file.name)}
						<div class="upload-file-row">
							<span class="upload-fname">{file.name}</span>
							<span class="upload-fsize">{formatBytes(file.size)}</span>
							{#if !uploading}
								<button class="upload-fremove" onclick={() => removeUploadFile(i)}>&times;</button>
							{/if}
						</div>
					{/each}
				</div>

				{#if uploading}
					<div class="upload-progress">
						<div class="upload-pbar-track">
							<div
								class="upload-pbar-fill"
								style="width: {uploadTotal > 0 ? (uploadedCount / uploadTotal) * 100 : 0}%"
							></div>
						</div>
						<span class="upload-pbar-text">{uploadedCount} / {uploadTotal}</span>
					</div>
				{:else}
					<button class="btn-primary btn-sm" onclick={handleUpload}>
						Upload {uploadFiles.length} file{uploadFiles.length !== 1 ? 's' : ''} to {uploadFolder}/
					</button>
				{/if}
			{/if}
		</div>
	</section>
</div>

<style>
	.page {
		max-width: 860px;
	}

	.back {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.8667rem;
		color: var(--text-muted);
		margin-bottom: 2rem;
	}
	.back:hover {
		color: var(--text);
	}

	.header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}
	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-shrink: 0;
	}
	h1 {
		font-size: 1.6rem;
		font-weight: 700;
		letter-spacing: -0.03em;
	}
	.meta {
		font-size: 0.8667rem;
		color: var(--text-muted);
		margin-top: 0.15rem;
	}
	.sep {
		opacity: 0.4;
	}
	.folder {
		opacity: 0.6;
	}

	/* Stats */
	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 2.5rem;
	}
	.st {
		flex: 1;
		min-width: 120px;
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 1rem 1.15rem;
		display: flex;
		flex-direction: column;
	}
	.st-val {
		font-size: 1.4rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.02em;
		line-height: 1.1;
	}
	.st-label {
		font-size: 0.75rem;
		color: var(--text-muted);
		margin-top: 0.1rem;
	}
	.st-sub {
		font-size: 0.75rem;
		color: var(--text-muted);
		opacity: 0.6;
		margin-top: 0.15rem;
	}

	/* Sections */
	.section {
		margin-bottom: 2.5rem;
	}
	h2 {
		font-size: 0.9333rem;
		font-weight: 600;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--border);
		margin-bottom: 1rem;
	}
	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--border);
		margin-bottom: 1rem;
	}
	.section-header h2 {
		border-bottom: none;
		padding-bottom: 0;
		margin-bottom: 0;
	}
	.h2-count {
		color: var(--text-muted);
		font-weight: 400;
	}

	.card {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.25rem;
	}
	.card-hint {
		font-size: 0.8667rem;
		color: var(--text-muted);
		margin-bottom: 1rem;
	}

	/* Paths */
	.paths {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.path {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.8667rem;
	}
	.path-k {
		font-size: 0.75rem;
		color: var(--text-muted);
		font-weight: 500;
		min-width: 3.5rem;
	}

	/* Settings grid */
	.settings-grid {
		display: flex;
		flex-direction: column;
	}
	.sg-row {
		display: flex;
		justify-content: space-between;
		padding: 0.45rem 0;
		border-bottom: 1px solid var(--border-subtle);
		font-size: 0.8667rem;
	}
	.sg-row:last-child {
		border-bottom: none;
	}
	.sg-row span:first-child {
		color: var(--text-muted);
	}
	.sg-val {
		font-weight: 500;
	}

	/* Cleanup */
	.cleanup-compare {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.9rem;
		margin-bottom: 0.75rem;
	}
	.arrow {
		color: var(--text-muted);
		opacity: 0.5;
	}
	.match-ok {
		color: var(--green);
		font-weight: 700;
		font-size: 1.1rem;
	}
	.match-warn {
		font-size: 0.75rem;
		color: var(--orange);
		font-weight: 500;
		background: var(--orange-bg);
		padding: 0.1rem 0.4rem;
		border-radius: var(--radius-full);
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
			transform 0.15s;
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
	.thumb-name {
		font-size: 0.7rem;
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	.thumb-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.3rem 0.5rem;
		gap: 0.25rem;
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
	}

	.thumb:hover .thumb-delete {
		opacity: 1;
	}

	.thumb-delete:hover {
		color: var(--red);
	}

	/* File list */
	.flist {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		max-height: 350px;
		overflow-y: auto;
	}
	.frow {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.85rem;
		font-size: 0.8rem;
		border-bottom: 1px solid var(--border-subtle);
	}
	.frow:last-child {
		border-bottom: none;
	}
	.fn {
		flex: 1;
		font-family: var(--font-mono);
		font-size: 0.8rem;
		color: var(--text-secondary);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.fs {
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
		flex-shrink: 0;
	}
	.frow-delete {
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
	}
	.frow:hover .frow-delete {
		opacity: 1;
	}
	.frow-delete:hover {
		color: var(--red);
	}

	/* Metadata */
	.meta-fields {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		margin-bottom: 1rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		max-width: 380px;
	}
	select,
	textarea {
		width: 100%;
	}

	/* Upload section */
	.upload-controls {
		margin-bottom: 1rem;
	}

	.upload-drop {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 1.25rem;
		border: 2px dashed var(--border-strong);
		border-radius: var(--radius-sm);
		margin-bottom: 1rem;
		transition: all 0.15s;
	}

	.upload-drop:hover {
		border-color: var(--accent);
		background: var(--accent-glow);
	}

	.upload-drop-icon {
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.upload-drop:hover .upload-drop-icon {
		color: var(--accent-light);
	}

	.upload-drop-text {
		font-size: 0.8667rem;
		color: var(--text-muted);
	}

	.upload-browse {
		cursor: pointer;
	}

	.upload-file-list {
		background: var(--bg-root);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		max-height: 180px;
		overflow-y: auto;
		margin-bottom: 0.75rem;
	}

	.upload-file-row {
		display: flex;
		align-items: center;
		padding: 0.35rem 0.75rem;
		font-size: 0.8rem;
		border-bottom: 1px solid var(--border-subtle);
	}

	.upload-file-row:last-child {
		border-bottom: none;
	}

	.upload-fname {
		flex: 1;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.upload-fsize {
		font-size: 0.75rem;
		color: var(--text-muted);
		margin: 0 0.5rem;
		font-variant-numeric: tabular-nums;
	}

	.upload-fremove {
		background: none;
		color: var(--text-muted);
		padding: 0 0.2rem;
		font-size: 1rem;
		line-height: 1;
	}

	.upload-fremove:hover {
		color: var(--red);
	}

	.upload-progress {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.upload-pbar-track {
		flex: 1;
		height: 5px;
		background: var(--bg-active);
		border-radius: 3px;
		overflow: hidden;
	}

	.upload-pbar-fill {
		height: 100%;
		background: linear-gradient(90deg, var(--accent), var(--pink));
		border-radius: 3px;
		transition: width 0.3s ease;
	}

	.upload-pbar-text {
		font-size: 0.8rem;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
</style>
