<script lang="ts">
	import { enhance } from '$app/forms';
	import DenoiseMonitor from '$lib/components/DenoiseMonitor.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import DownloadDialog from '$lib/components/DownloadDialog.svelte';
	import SettingsDialog from '$lib/components/SettingsDialog.svelte';
	import WorkflowTabs from '$lib/components/WorkflowTabs.svelte';
	import RatedGallery from '$lib/components/RatedGallery.svelte';
	import RatingView from '$lib/components/RatingView.svelte';
	import StarRating from '$lib/components/StarRating.svelte';
	import { formatBytes, formatDate } from '$lib/utils.js';
	import { PURERAW_SETTINGS } from '$lib/types.js';
	import type { StarRating as StarRatingType } from '$lib/types.js';
	import { goto, invalidateAll } from '$app/navigation';

	let { data, form } = $props();

	// View state
	let currentView = $state('raw');
	let initialViewSet = $state(false);

	$effect(() => {
		if (initialViewSet) return;
		const s = data.shoot.status;
		if (s === 'exported') currentView = 'export';
		else if (s === 'curating') currentView = 'selects';
		else if (s === 'rating') currentView = 'rate';
		else if (s === 'ready' || s === 'denoising') currentView = 'denoised';
		else currentView = 'raw';
		initialViewSet = true;
	});

	// Dialogs
	let showDownloadDialog = $state(false);
	let showSettingsDialog = $state(false);
	let showRatingView = $state(false);

	// Delete state
	let showDeleteAllDialog = $state(false);
	let showDeleteSingleDialog = $state(false);
	let deleting = $state(false);
	let deleteTargetFile = $state<string | null>(null);
	let deleteTargetFolder = $state<'exports' | 'denoised' | 'raw' | 'rated' | 'selects'>('exports');

	let deleteAllTitle = $derived(
		({
			raw: 'Delete raw files?',
			denoised: 'Delete all denoised files?',
			rated: 'Delete all rated files?',
			selects: 'Delete all selects?',
			exports: 'Delete all exports?'
		})[deleteTargetFolder]
	);

	let deleteAllMessage = $derived(
		({
			raw: `This will permanently delete ${data.shoot.rawCount} ARW file${data.shoot.rawCount !== 1 ? 's' : ''} (${formatBytes(data.shoot.rawSizeBytes)}). This cannot be undone.`,
			denoised: `This will permanently delete ${data.shoot.dngCount} DNG file${data.shoot.dngCount !== 1 ? 's' : ''} (${formatBytes(data.shoot.dngSizeBytes)}). This cannot be undone.`,
			rated: `This will permanently delete ${data.shoot.ratedCount} rated file${data.shoot.ratedCount !== 1 ? 's' : ''} (${formatBytes(data.shoot.ratedSizeBytes)}) and their ratings. This cannot be undone.`,
			selects: `This will permanently delete ${data.shoot.selectCount} select${data.shoot.selectCount !== 1 ? 's' : ''} (${formatBytes(data.shoot.selectSizeBytes)}). This cannot be undone.`,
			exports: `This will permanently delete ${data.shoot.exportCount} exported file${data.shoot.exportCount !== 1 ? 's' : ''} (${formatBytes(data.shoot.exportSizeBytes)}) and their cached thumbnails. This cannot be undone.`
		})[deleteTargetFolder]
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

	// Rating state
	let ratingFilterStar = $state<number>(0);
	let selectMinRating = $state<StarRatingType>(4);
	let movingToSelects = $state(false);

	let filteredRatedFiles = $derived(
		ratingFilterStar === 0
			? data.shoot.ratedFiles
			: data.shoot.ratedFiles.filter((f) => f.rating === ratingFilterStar)
	);

	async function handleDeleteFiles(folder: 'exports' | 'denoised' | 'raw' | 'rated' | 'selects', files?: string[]) {
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
		const res = await fetch(`/api/shoots/${encodeURIComponent(data.shoot.folderName)}`, {
			method: 'DELETE'
		});
		if (res.ok) {
			await goto('/');
		}
	}

	function requestDeleteSingle(folder: 'exports' | 'denoised' | 'raw' | 'rated' | 'selects', fileName: string) {
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

		await fetch(`/api/upload/${encodeURIComponent(data.shoot.folderName)}`, { method: 'PATCH' });
		uploadFiles = [];
		uploading = false;
		uploadedCount = 0;
		uploadTotal = 0;
		await invalidateAll();
	}

	async function handleRatingSave(ratings: Array<{ file: string; rating: StarRatingType }>) {
		const res = await fetch(`/api/shoots/${encodeURIComponent(data.shoot.folderName)}/rate`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ratings })
		});
		if (res.ok) {
			showRatingView = false;
			await invalidateAll();
		}
	}

	async function handleInlineRatingChange(file: string, rating: StarRatingType) {
		await fetch(`/api/shoots/${encodeURIComponent(data.shoot.folderName)}/rate`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ file, rating })
		});
		await invalidateAll();
	}

	async function handleMoveToSelects() {
		movingToSelects = true;
		try {
			const res = await fetch(`/api/shoots/${encodeURIComponent(data.shoot.folderName)}/selects`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ minRating: selectMinRating })
			});
			if (res.ok) {
				await invalidateAll();
			}
		} finally {
			movingToSelects = false;
		}
	}
</script>

<div class="page">
	<a href="/" class="back">
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 18 9 12 15 6" /></svg>
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
			<button class="btn-ghost btn-icon" onclick={() => (showSettingsDialog = true)} title="Settings">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="12" cy="12" r="3" />
					<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
				</svg>
			</button>
			<button class="btn-ghost btn-icon" onclick={() => (showDownloadDialog = true)} title="Download">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
					<polyline points="7 10 12 15 17 10" />
					<line x1="12" y1="15" x2="12" y2="3" />
				</svg>
			</button>
			<span class="badge badge-{data.shoot.status}">{data.shoot.status}</span>
		</div>
	</div>

	<WorkflowTabs shoot={data.shoot} {currentView} onchange={(v) => (currentView = v)} />

	<!-- ═══ RAW VIEW ═══ -->
	{#if currentView === 'raw'}
		<div class="view">
			<!-- Upload -->
			<section class="section">
				<h2>Upload Raw Files</h2>
				<div class="card">
					<div class="upload-controls">
						<div class="field" style="max-width: 200px;">
							<label for="upload-folder">Target folder</label>
							<select id="upload-folder" bind:value={uploadFolder}>
								<option value="raw">Raw</option>
								<option value="denoised">Denoised</option>
								<option value="exports">Exports</option>
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
						<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="upload-drop-icon">
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
							<polyline points="17 8 12 3 7 8" />
							<line x1="12" y1="3" x2="12" y2="15" />
						</svg>
						<span class="upload-drop-text">Drop files or</span>
						<label class="btn-ghost btn-sm upload-browse">
							Browse
							<input type="file" accept={UPLOAD_ACCEPT[uploadFolder]} multiple onchange={handleUploadFileSelect} hidden />
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
									<div class="upload-pbar-fill" style="width: {uploadTotal > 0 ? (uploadedCount / uploadTotal) * 100 : 0}%"></div>
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

			<!-- Raw file list -->
			{#if data.shoot.rawFiles.length > 0}
				<section class="section">
					<div class="section-header">
						<h2>Raw Files <span class="h2-count">{data.shoot.rawCount} &middot; {formatBytes(data.shoot.rawSizeBytes)}</span></h2>
						<button class="btn-danger btn-sm" onclick={() => { deleteTargetFolder = 'raw'; showDeleteAllDialog = true; }}>
							Delete All
						</button>
					</div>
					<div class="flist">
						{#each data.shoot.rawFiles as file (file.name)}
							<div class="frow">
								<span class="fn">{file.name}</span>
								<span class="fs">{formatBytes(file.sizeBytes)}</span>
								<button class="frow-delete" onclick={() => requestDeleteSingle('raw', file.name)} title="Delete">&times;</button>
							</div>
						{/each}
					</div>
				</section>

				<!-- Cleanup -->
				<section class="section">
					<h2>Cleanup</h2>
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
						<button class="btn-danger" onclick={() => { deleteTargetFolder = 'raw'; showDeleteAllDialog = true; }}>Delete Raw Files</button>
					</div>
				</section>
			{/if}
		</div>

	<!-- ═══ DENOISED VIEW ═══ -->
	{:else if currentView === 'denoised'}
		<div class="view">
			{#if data.shoot.dngFiles.length > 0}
				<button class="next-action" onclick={() => (currentView = 'rate')}>
					<span class="next-action-content">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
						</svg>
						<span class="next-action-text">
							<strong>Start Rating</strong>
							<span>Review {data.shoot.dngCount} denoised image{data.shoot.dngCount !== 1 ? 's' : ''} and assign star ratings</span>
						</span>
					</span>
					<svg class="next-action-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6" /></svg>
				</button>
			{/if}

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

			<!-- DNG files -->
			{#if data.shoot.dngFiles.length > 0}
				<section class="section">
					<div class="section-header">
						<h2>Denoised Files <span class="h2-count">{data.shoot.dngCount} &middot; {formatBytes(data.shoot.dngSizeBytes)}</span></h2>
						<button class="btn-danger btn-sm" onclick={() => { deleteTargetFolder = 'denoised'; showDeleteAllDialog = true; }}>
							Delete All
						</button>
					</div>
					<div class="flist">
						{#each data.shoot.dngFiles as file (file.name)}
							<div class="frow">
								<span class="fn">{file.name}</span>
								<span class="fs">{formatBytes(file.sizeBytes)}</span>
								<button class="frow-delete" onclick={() => requestDeleteSingle('denoised', file.name)} title="Delete">&times;</button>
							</div>
						{/each}
					</div>
				</section>
			{/if}
		</div>

	<!-- ═══ RATE VIEW ═══ -->
	{:else if currentView === 'rate'}
		<div class="view">
			{#if data.shoot.dngFiles.length > 0}
				<button class="next-action next-action-gold" onclick={() => (showRatingView = true)}>
					<span class="next-action-content">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
						</svg>
						<span class="next-action-text">
							<strong>Open Rating View</strong>
							<span>{data.shoot.dngCount} image{data.shoot.dngCount !== 1 ? 's' : ''} to review &middot; Press 1-5 to rate, arrows to navigate</span>
						</span>
					</span>
					<svg class="next-action-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6" /></svg>
				</button>
			{/if}

			{#if data.shoot.ratedFiles.length > 0}
				<button class="next-action next-action-pink" onclick={handleMoveToSelects} disabled={movingToSelects}>
					<span class="next-action-content">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
							<polyline points="22 4 12 14.01 9 11.01" />
						</svg>
						<span class="next-action-text">
							<strong>{movingToSelects ? 'Moving...' : 'Move to Selects'}</strong>
							<span>
								Send
								<select class="inline-select" bind:value={selectMinRating} onclick={(e) => e.stopPropagation()}>
									<option value={5}>5★ only</option>
									<option value={4}>≥ 4★</option>
									<option value={3}>≥ 3★</option>
									<option value={2}>≥ 2★</option>
									<option value={1}>all rated</option>
								</select>
								images to the selects folder
							</span>
						</span>
					</span>
					<svg class="next-action-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6" /></svg>
				</button>

				<section class="section">
					<div class="section-header">
						<h2>Rated Files <span class="h2-count">{data.shoot.ratedCount} &middot; {formatBytes(data.shoot.ratedSizeBytes)}</span></h2>
						<div class="section-actions">
							<div class="filter-bar">
								<button class="filter-btn" class:active={ratingFilterStar === 0} onclick={() => (ratingFilterStar = 0)}>All</button>
								{#each [5, 4, 3, 2, 1] as star}
									<button class="filter-btn" class:active={ratingFilterStar === star} onclick={() => (ratingFilterStar = star)}>
										{star}★
									</button>
								{/each}
							</div>
							<button class="btn-danger btn-sm" onclick={() => { deleteTargetFolder = 'rated'; showDeleteAllDialog = true; }}>
								Delete All
							</button>
						</div>
					</div>

					<RatedGallery
						shootName={data.shoot.folderName}
						files={filteredRatedFiles}
						folder="rated"
						ondelete={(f) => requestDeleteSingle('rated', f)}
						onratingchange={handleInlineRatingChange}
					/>
				</section>
			{:else if data.shoot.dngFiles.length === 0}
				<section class="section">
					<div class="empty-view">
						<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="empty-icon">
							<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
						</svg>
						<p class="empty-title">No images to rate</p>
						<p class="empty-sub">Denoise images first, then come back to rate them.</p>
					</div>
				</section>
			{/if}
		</div>

	<!-- ═══ SELECTS VIEW ═══ -->
	{:else if currentView === 'selects'}
		<div class="view">
			{#if data.shoot.selectFiles.length > 0}
				<section class="section">
					<div class="section-header">
						<h2>Selects <span class="h2-count">{data.shoot.selectCount} &middot; {formatBytes(data.shoot.selectSizeBytes)}</span></h2>
						<button class="btn-danger btn-sm" onclick={() => { deleteTargetFolder = 'selects'; showDeleteAllDialog = true; }}>
							Delete All
						</button>
					</div>
					<RatedGallery
						shootName={data.shoot.folderName}
						files={data.shoot.selectFiles}
						folder="selects"
						ondelete={(f) => requestDeleteSingle('selects', f)}
					/>
				</section>
			{:else}
				{#if data.shoot.ratedCount > 0}
					<button class="next-action next-action-pink" onclick={() => (currentView = 'rate')}>
						<span class="next-action-content">
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
							</svg>
							<span class="next-action-text">
								<strong>Go to Rating</strong>
								<span>{data.shoot.ratedCount} rated image{data.shoot.ratedCount !== 1 ? 's' : ''} ready to move into selects</span>
							</span>
						</span>
						<svg class="next-action-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6" /></svg>
					</button>
				{/if}
				<section class="section">
					<div class="empty-view">
						<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="empty-icon">
							<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
							<polyline points="22 4 12 14.01 9 11.01" />
						</svg>
						<p class="empty-title">No selects yet</p>
						<p class="empty-sub">Rate your images first, then move your favorites here.</p>
					</div>
				</section>
			{/if}
		</div>

	<!-- ═══ EXPORT VIEW ═══ -->
	{:else if currentView === 'export'}
		<div class="view">
			{#if data.shoot.exportFiles.length > 0}
				<section class="section">
					<div class="section-header">
						<h2>Exports <span class="h2-count">{data.shoot.exportCount} &middot; {formatBytes(data.shoot.exportSizeBytes)}</span></h2>
						<button class="btn-danger btn-sm" onclick={() => { deleteTargetFolder = 'exports'; showDeleteAllDialog = true; }}>
							Delete All
						</button>
					</div>
					<div class="gallery">
						{#each data.shoot.exportFiles as file (file.name)}
							<div class="thumb">
								<img
									src="/api/thumbs/{encodeURIComponent(data.shoot.folderName)}/{encodeURIComponent(file.name)}"
									alt={file.name}
									loading="lazy"
								/>
								<div class="thumb-footer">
									<span class="thumb-name">{file.name}</span>
									<button class="thumb-delete" onclick={() => requestDeleteSingle('exports', file.name)} title="Delete">&times;</button>
								</div>
							</div>
						{/each}
					</div>
				</section>
			{:else}
				<section class="section">
					<div class="empty-view">
						<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="empty-icon">
							<rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
							<circle cx="8.5" cy="8.5" r="1.5" />
							<polyline points="21 15 16 10 5 21" />
						</svg>
						<p class="empty-title">No exports yet</p>
						<p class="empty-sub">Upload your exported images here.</p>
					</div>
				</section>
			{/if}

			<!-- Upload exports -->
			<section class="section">
				<h2>Upload Exports</h2>
				<div class="card">
					<div
						class="upload-drop"
						ondragover={(e) => e.preventDefault()}
						ondrop={(e) => { uploadFolder = 'exports'; handleUploadDrop(e); }}
						role="region"
						aria-label="Upload exports drop zone"
					>
						<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="upload-drop-icon">
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
							<polyline points="17 8 12 3 7 8" />
							<line x1="12" y1="3" x2="12" y2="15" />
						</svg>
						<span class="upload-drop-text">Drop exports or</span>
						<label class="btn-ghost btn-sm upload-browse">
							Browse
							<input type="file" accept={UPLOAD_ACCEPT.exports} multiple onchange={(e) => { uploadFolder = 'exports'; handleUploadFileSelect(e); }} hidden />
						</label>
					</div>

					{#if uploadFiles.length > 0 && uploadFolder === 'exports'}
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
									<div class="upload-pbar-fill" style="width: {uploadTotal > 0 ? (uploadedCount / uploadTotal) * 100 : 0}%"></div>
								</div>
								<span class="upload-pbar-text">{uploadedCount} / {uploadTotal}</span>
							</div>
						{:else}
							<button class="btn-primary btn-sm" onclick={handleUpload}>
								Upload {uploadFiles.length} file{uploadFiles.length !== 1 ? 's' : ''} to exports/
							</button>
						{/if}
					{/if}
				</div>
			</section>
		</div>
	{/if}

	<!-- Dialogs (always rendered) -->
	<DownloadDialog open={showDownloadDialog} shoot={data.shoot} oncancel={() => (showDownloadDialog = false)} />
	<SettingsDialog open={showSettingsDialog} shoot={data.shoot} formResult={form} oncancel={() => (showSettingsDialog = false)} ondeleteproject={handleDeleteProject} />
	<ConfirmDialog open={showDeleteAllDialog} title={deleteAllTitle} message={deleteAllMessage} confirmLabel={deleting ? 'Deleting...' : 'Delete All'} onconfirm={() => handleDeleteFiles(deleteTargetFolder)} oncancel={() => (showDeleteAllDialog = false)} />
	<ConfirmDialog open={showDeleteSingleDialog} title="Delete file?" message="This will permanently delete {deleteTargetFile ?? ''}. This cannot be undone." confirmLabel={deleting ? 'Deleting...' : 'Delete'} onconfirm={() => handleDeleteFiles(deleteTargetFolder, [deleteTargetFile!])} oncancel={() => { showDeleteSingleDialog = false; deleteTargetFile = null; }} />

	{#if showRatingView}
		<RatingView
			shootName={data.shoot.folderName}
			files={data.shoot.dngFiles}
			existingRatings={data.shoot.metadata.ratings}
			onclose={() => (showRatingView = false)}
			onsave={handleRatingSave}
		/>
	{/if}
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
		margin-bottom: 0.5rem;
	}
	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
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
	.sep { opacity: 0.4; }
	.folder { opacity: 0.6; }

	.btn-icon {
		padding: 0.4rem;
		border-radius: var(--radius-sm);
	}

	/* Views */
	.view {
		animation: slide-up 0.25s ease;
	}

	/* Next-action CTA buttons */
	.next-action {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 1rem 1.25rem;
		margin-bottom: 2rem;
		background: linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(99, 102, 241, 0.06) 50%, rgba(139, 92, 246, 0.12) 100%);
		border: 1px solid rgba(99, 102, 241, 0.25);
		border-radius: var(--radius);
		color: var(--text);
		cursor: pointer;
		transition: all 0.2s ease;
		text-align: left;
		position: relative;
		overflow: hidden;
	}

	.next-action::before {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, transparent 60%);
		opacity: 0;
		transition: opacity 0.2s;
	}

	.next-action:hover:not(:disabled)::before {
		opacity: 1;
	}

	.next-action:hover:not(:disabled) {
		border-color: rgba(99, 102, 241, 0.4);
		transform: translateY(-2px);
		box-shadow: 0 8px 32px rgba(99, 102, 241, 0.15), 0 0 0 1px rgba(99, 102, 241, 0.1);
	}

	.next-action:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	.next-action-gold {
		background: linear-gradient(135deg, rgba(234, 179, 8, 0.12) 0%, rgba(234, 179, 8, 0.04) 50%, rgba(245, 158, 11, 0.1) 100%);
		border-color: rgba(234, 179, 8, 0.2);
	}

	.next-action-gold::before {
		background: linear-gradient(135deg, rgba(234, 179, 8, 0.06) 0%, transparent 60%);
	}

	.next-action-gold:hover:not(:disabled) {
		border-color: rgba(234, 179, 8, 0.35);
		box-shadow: 0 8px 32px rgba(234, 179, 8, 0.1), 0 0 0 1px rgba(234, 179, 8, 0.08);
	}

	.next-action-pink {
		background: linear-gradient(135deg, rgba(236, 72, 153, 0.12) 0%, rgba(236, 72, 153, 0.04) 50%, rgba(168, 85, 247, 0.1) 100%);
		border-color: rgba(236, 72, 153, 0.2);
	}

	.next-action-pink::before {
		background: linear-gradient(135deg, rgba(236, 72, 153, 0.06) 0%, transparent 60%);
	}

	.next-action-pink:hover:not(:disabled) {
		border-color: rgba(236, 72, 153, 0.35);
		box-shadow: 0 8px 32px rgba(236, 72, 153, 0.1), 0 0 0 1px rgba(236, 72, 153, 0.08);
	}

	.next-action-content {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		position: relative;
		z-index: 1;
	}

	.next-action-content > svg {
		flex-shrink: 0;
		color: var(--accent-light);
	}

	.next-action-gold .next-action-content > svg {
		color: var(--yellow);
	}

	.next-action-pink .next-action-content > svg {
		color: var(--pink);
	}

	.next-action-text {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.next-action-text strong {
		font-size: 0.9333rem;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.next-action-text span {
		font-size: 0.8rem;
		color: var(--text-secondary);
	}

	.next-action-arrow {
		flex-shrink: 0;
		color: var(--text-muted);
		transition: transform 0.2s, color 0.2s;
		position: relative;
		z-index: 1;
	}

	.next-action:hover:not(:disabled) .next-action-arrow {
		transform: translateX(3px);
		color: var(--text-secondary);
	}

	.inline-select {
		font-size: 0.8rem;
		padding: 0.1rem 1.2rem 0.1rem 0.35rem;
		background: var(--bg-active);
		border: 1px solid var(--border-strong);
		border-radius: 4px;
		color: var(--text);
		cursor: pointer;
		display: inline;
		width: auto;
	}

	/* Sections */
	.section { margin-bottom: 2.5rem; }

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
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.section-header h2 {
		border-bottom: none;
		padding-bottom: 0;
		margin-bottom: 0;
	}
	.section-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
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
	.paths { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem; }
	.path { display: flex; align-items: center; gap: 0.75rem; font-size: 0.8667rem; }
	.path-k { font-size: 0.75rem; color: var(--text-muted); font-weight: 500; min-width: 3.5rem; }

	/* Settings grid */
	.settings-grid { display: flex; flex-direction: column; }
	.sg-row { display: flex; justify-content: space-between; padding: 0.45rem 0; border-bottom: 1px solid var(--border-subtle); font-size: 0.8667rem; }
	.sg-row:last-child { border-bottom: none; }
	.sg-row span:first-child { color: var(--text-muted); }
	.sg-val { font-weight: 500; }

	/* Cleanup */
	.cleanup-compare { display: flex; align-items: center; gap: 0.75rem; font-size: 0.9rem; margin-bottom: 0.75rem; }
	.arrow { color: var(--text-muted); opacity: 0.5; }
	.match-ok { color: var(--green); font-weight: 700; font-size: 1.1rem; }
	.match-warn { font-size: 0.75rem; color: var(--orange); font-weight: 500; background: var(--orange-bg); padding: 0.1rem 0.4rem; border-radius: var(--radius-full); }

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
		transition: border-color 0.15s, transform 0.15s;
	}
	.thumb:hover { border-color: var(--border-strong); transform: translateY(-2px); }
	.thumb img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; background: var(--bg-elevated); }
	.thumb-name { font-size: 0.7rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
	.thumb-footer { display: flex; align-items: center; justify-content: space-between; padding: 0.3rem 0.5rem; gap: 0.25rem; }
	.thumb-delete { background: none; color: var(--text-muted); font-size: 1rem; line-height: 1; padding: 0 0.2rem; flex-shrink: 0; opacity: 0; transition: opacity 0.15s, color 0.15s; border-radius: 0; }
	.thumb:hover .thumb-delete { opacity: 1; }
	.thumb-delete:hover { color: var(--red); }

	/* File list */
	.flist { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-sm); max-height: 350px; overflow-y: auto; }
	.frow { display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.85rem; font-size: 0.8rem; border-bottom: 1px solid var(--border-subtle); }
	.frow:last-child { border-bottom: none; }
	.fn { flex: 1; font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.fs { color: var(--text-muted); font-variant-numeric: tabular-nums; flex-shrink: 0; }
	.frow-delete { background: none; color: var(--text-muted); font-size: 1rem; line-height: 1; padding: 0 0.2rem; flex-shrink: 0; opacity: 0; transition: opacity 0.15s, color 0.15s; border-radius: 0; }
	.frow:hover .frow-delete { opacity: 1; }
	.frow-delete:hover { color: var(--red); }

	/* Filter bar */
	.filter-bar {
		display: flex;
		gap: 2px;
		background: var(--bg-active);
		border-radius: var(--radius-sm);
		padding: 2px;
	}
	.filter-btn {
		background: none;
		color: var(--text-muted);
		font-size: 0.7rem;
		font-weight: 500;
		padding: 0.2rem 0.45rem;
		border-radius: 4px;
		transition: all 0.15s;
	}
	.filter-btn:hover { color: var(--text-secondary); }
	.filter-btn.active { background: var(--bg-surface); color: var(--text); box-shadow: 0 1px 2px rgba(0,0,0,0.2); }

	/* Batch action */
	.batch-action {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1.25rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}
	.batch-label { font-size: 0.8rem; color: var(--text-secondary); white-space: nowrap; }
	.batch-select { font-size: 0.8rem; padding: 0.3rem 1.5rem 0.3rem 0.5rem; }

	/* Empty view */
	.empty-view {
		text-align: center;
		padding: 3rem 2rem;
	}
	.empty-icon { color: var(--text-muted); opacity: 0.4; margin-bottom: 0.75rem; }
	.empty-title { font-size: 1rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.25rem; }
	.empty-sub { font-size: 0.8667rem; color: var(--text-muted); margin-bottom: 1rem; }

	/* Upload section */
	.upload-controls { margin-bottom: 1rem; }
	.field { display: flex; flex-direction: column; gap: 0.35rem; max-width: 380px; }
	select { width: 100%; }

	.upload-drop {
		display: flex; align-items: center; justify-content: center; gap: 0.5rem;
		padding: 1.25rem; border: 2px dashed var(--border-strong); border-radius: var(--radius-sm); margin-bottom: 1rem; transition: all 0.15s;
	}
	.upload-drop:hover { border-color: var(--accent); background: var(--accent-glow); }
	.upload-drop-icon { color: var(--text-muted); flex-shrink: 0; }
	.upload-drop:hover .upload-drop-icon { color: var(--accent-light); }
	.upload-drop-text { font-size: 0.8667rem; color: var(--text-muted); }
	.upload-browse { cursor: pointer; }

	.upload-file-list { background: var(--bg-root); border: 1px solid var(--border); border-radius: var(--radius-sm); max-height: 180px; overflow-y: auto; margin-bottom: 0.75rem; }
	.upload-file-row { display: flex; align-items: center; padding: 0.35rem 0.75rem; font-size: 0.8rem; border-bottom: 1px solid var(--border-subtle); }
	.upload-file-row:last-child { border-bottom: none; }
	.upload-fname { flex: 1; font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.upload-fsize { font-size: 0.75rem; color: var(--text-muted); margin: 0 0.5rem; font-variant-numeric: tabular-nums; }
	.upload-fremove { background: none; color: var(--text-muted); padding: 0 0.2rem; font-size: 1rem; line-height: 1; border-radius: 0; }
	.upload-fremove:hover { color: var(--red); }

	.upload-progress { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; }
	.upload-pbar-track { flex: 1; height: 5px; background: var(--bg-active); border-radius: 3px; overflow: hidden; }
	.upload-pbar-fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--pink)); border-radius: 3px; transition: width 0.3s ease; }
	.upload-pbar-text { font-size: 0.8rem; color: var(--text-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
</style>
