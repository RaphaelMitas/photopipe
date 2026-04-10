<script lang="ts">
	import { goto } from '$app/navigation';
	import { formatBytes, slugifyName, buildFolderName } from '$lib/utils.js';

	const today = new Date().toISOString().split('T')[0];

	let name = $state('');
	let date = $state(today);
	let files = $state<File[]>([]);
	let error = $state('');

	// Upload state
	let phase = $state<'form' | 'uploading' | 'done'>('form');
	let uploadedCount = $state(0);
	let uploadedBytes = $state(0);
	let currentFile = $state('');
	let failedFiles = $state<string[]>([]);
	let shootFolderName = $state('');

	const totalSize = $derived(files.reduce((sum, f) => sum + f.size, 0));
	const folderPreview = $derived(
		name.trim() ? buildFolderName(name, date) : `${date}_shoot-name`
	);
	const progress = $derived(files.length > 0 ? uploadedCount / files.length : 0);

	function handleFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files) {
			addFiles(Array.from(input.files));
		}
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault;
		if (e.dataTransfer?.files) {
			addFiles(Array.from(e.dataTransfer.files));
		}
	}

	function addFiles(newFiles: File[]) {
		const arwFiles = newFiles.filter((f) => f.name.toLowerCase().endsWith('.arw'));
		// Deduplicate by name
		const existing = new Set(files.map((f) => f.name));
		const unique = arwFiles.filter((f) => !existing.has(f.name));
		files = [...files, ...unique];
	}

	function removeFile(index: number) {
		files = files.filter((_, i) => i !== index);
	}

	function clearFiles() {
		files = [];
	}

	async function handleSubmit() {
		error = '';

		if (!name.trim()) {
			error = 'Shoot name is required';
			return;
		}

		if (files.length === 0) {
			error = 'Select at least one ARW file to upload';
			return;
		}

		phase = 'uploading';

		// Step 1: Create the shoot via JSON API
		try {
			const createRes = await fetch('/api/shoots', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: name.trim(), date })
			});

			if (!createRes.ok) {
				const err = await createRes.json().catch(() => ({ message: 'Failed to create shoot' }));
				error = err.message || 'Failed to create shoot';
				phase = 'form';
				return;
			}

			const result = await createRes.json();
			shootFolderName = result.folderName;
		} catch {
			error = 'Failed to create shoot. Check your connection.';
			phase = 'form';
			return;
		}

		// Step 2: Upload files in parallel batches of 3
		const BATCH_SIZE = 3;
		for (let i = 0; i < files.length; i += BATCH_SIZE) {
			const batch = files.slice(i, i + BATCH_SIZE);
			const results = await Promise.allSettled(
				batch.map(async (file) => {
					currentFile = file.name;
					const formData = new FormData();
					formData.append('file', file);

					const res = await fetch(
						`/api/upload/${encodeURIComponent(shootFolderName)}`,
						{ method: 'POST', body: formData }
					);

					if (!res.ok) throw new Error(`Upload failed: ${file.name}`);
					return file;
				})
			);

			for (const result of results) {
				if (result.status === 'fulfilled') {
					uploadedCount++;
					uploadedBytes += result.value.size;
				} else {
					failedFiles = [...failedFiles, batch[results.indexOf(result)]?.name ?? 'unknown'];
				}
			}
		}

		// Step 3: Finalize — update rawCount in metadata
		await fetch(`/api/upload/${encodeURIComponent(shootFolderName)}`, { method: 'PATCH' });

		currentFile = '';
		phase = 'done';
	}
</script>

<div class="page">
	<a href="/" class="back">&larr; Dashboard</a>

	{#if phase === 'form'}
		<h1>New Shoot</h1>
		<p class="hint">Name your shoot, select your ARW files, and upload everything in one go.</p>

		{#if error}
			<div class="error">{error}</div>
		{/if}

		<div class="form-grid">
			<div class="field">
				<label for="name">Shoot Name</label>
				<input
					type="text"
					id="name"
					bind:value={name}
					placeholder="e.g. Spring Concert"
				/>
			</div>

			<div class="field">
				<label for="date">Date</label>
				<input type="date" id="date" bind:value={date} />
			</div>
		</div>

		<div class="preview-row">
			<span class="preview-label">Folder:</span>
			<code>{folderPreview}/</code>
		</div>

		<!-- File selection area -->
		<div
			class="drop-zone"
			ondragover={(e) => e.preventDefault()}
			ondrop={handleDrop}
			role="region"
			aria-label="File drop zone"
		>
			<div class="drop-content">
				<p class="drop-title">Drag ARW files here</p>
				<p class="drop-or">or</p>
				<label class="file-btn btn-ghost">
					Select Files
					<input
						type="file"
						accept=".arw,.ARW"
						multiple
						onchange={handleFileSelect}
						hidden
					/>
				</label>
				<label class="file-btn btn-ghost">
					Select Folder
					<!-- @ts-ignore -->
					<input
						type="file"
						onchange={handleFileSelect}
						hidden
						webkitdirectory
					/>
				</label>
			</div>
		</div>

		{#if files.length > 0}
			<div class="file-summary">
				<div class="file-summary-info">
					<strong>{files.length}</strong> ARW file{files.length !== 1 ? 's' : ''}
					<span class="text-muted">&mdash; {formatBytes(totalSize)}</span>
				</div>
				<button class="btn-ghost" onclick={clearFiles}>Clear All</button>
			</div>

			<div class="file-list">
				{#each files as file, i (file.name)}
					<div class="file-row">
						<span class="file-name">{file.name}</span>
						<span class="file-size">{formatBytes(file.size)}</span>
						<button class="remove-btn" onclick={() => removeFile(i)}>&times;</button>
					</div>
				{/each}
			</div>
		{/if}

		<button
			class="btn-primary submit-btn"
			onclick={handleSubmit}
			disabled={!name.trim() || files.length === 0}
		>
			Create Shoot &amp; Upload {files.length} File{files.length !== 1 ? 's' : ''}
		</button>

	{:else if phase === 'uploading'}
		<h1>Uploading...</h1>

		<div class="upload-progress">
			<div class="progress-bar">
				<div class="progress-fill" style="width: {progress * 100}%"></div>
			</div>
			<div class="progress-info">
				<span>{uploadedCount} / {files.length} files</span>
				<span>{Math.round(progress * 100)}%</span>
			</div>
			<div class="progress-detail">
				{#if currentFile}
					<span>Uploading: <code>{currentFile}</code></span>
				{/if}
				<span class="text-muted">{formatBytes(uploadedBytes)} uploaded</span>
			</div>
		</div>

	{:else if phase === 'done'}
		<h1>Upload Complete</h1>

		<div class="done-summary">
			<div class="done-stat">
				<span class="done-value">{uploadedCount}</span>
				<span class="done-label">files uploaded</span>
			</div>
			<div class="done-stat">
				<span class="done-value">{formatBytes(uploadedBytes)}</span>
				<span class="done-label">total size</span>
			</div>
		</div>

		{#if failedFiles.length > 0}
			<div class="error">
				{failedFiles.length} file{failedFiles.length !== 1 ? 's' : ''} failed to upload:
				{failedFiles.join(', ')}
			</div>
		{/if}

		<p class="done-hint">
			Now open PureRAW on bean.local and process the files from <code>raw/</code> to <code>denoised/</code>.
		</p>

		<div class="done-actions">
			<a href="/shoot/{encodeURIComponent(shootFolderName)}" class="btn-primary">
				Go to Shoot
			</a>
			<a href="/" class="btn-ghost">Dashboard</a>
		</div>
	{/if}
</div>

<style>
	.page {
		max-width: 600px;
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

	h1 {
		font-size: 1.5rem;
		font-weight: 700;
		margin-bottom: 0.25rem;
	}

	.hint {
		color: var(--text-muted);
		font-size: 0.875rem;
		margin-bottom: 1.5rem;
	}

	.error {
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.3);
		color: var(--danger);
		padding: 0.75rem 1rem;
		border-radius: var(--radius);
		margin-bottom: 1rem;
		font-size: 0.875rem;
	}

	.form-grid {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	label:not(.file-btn) {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--text-secondary);
	}

	input[type='text'],
	input[type='date'] {
		width: 100%;
	}

	.preview-row {
		padding: 0.6rem 0.75rem;
		background: var(--bg-tertiary);
		border-radius: var(--radius);
		font-size: 0.85rem;
		margin-bottom: 1.5rem;
	}

	.preview-label {
		color: var(--text-muted);
		margin-right: 0.5rem;
	}

	/* Drop zone */
	.drop-zone {
		border: 2px dashed var(--border-light);
		border-radius: var(--radius-lg);
		padding: 2rem;
		text-align: center;
		transition:
			border-color 0.15s,
			background 0.15s;
		margin-bottom: 1rem;
	}

	.drop-zone:hover {
		border-color: var(--accent);
		background: rgba(59, 130, 246, 0.03);
	}

	.drop-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}

	.drop-title {
		font-size: 1rem;
		font-weight: 500;
	}

	.drop-or {
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	.file-btn {
		cursor: pointer;
		font-size: 0.85rem;
		padding: 0.4rem 0.75rem;
		display: inline-block;
	}

	/* File list */
	.file-summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.5rem;
		font-size: 0.9rem;
	}

	.file-summary-info {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.text-muted {
		color: var(--text-muted);
	}

	.file-list {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		max-height: 250px;
		overflow-y: auto;
		margin-bottom: 1.5rem;
	}

	.file-row {
		display: flex;
		align-items: center;
		padding: 0.4rem 0.75rem;
		font-size: 0.8rem;
		border-bottom: 1px solid var(--border);
	}

	.file-row:last-child {
		border-bottom: none;
	}

	.file-name {
		flex: 1;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.file-size {
		color: var(--text-muted);
		margin: 0 0.5rem;
		font-variant-numeric: tabular-nums;
	}

	.remove-btn {
		background: none;
		color: var(--text-muted);
		padding: 0 0.25rem;
		font-size: 1rem;
		line-height: 1;
	}

	.remove-btn:hover {
		color: var(--danger);
	}

	.submit-btn {
		padding: 0.65rem 1.5rem;
		font-size: 0.95rem;
	}

	/* Upload progress */
	.upload-progress {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.5rem;
		margin-top: 1.5rem;
	}

	.progress-bar {
		height: 8px;
		background: var(--bg-tertiary);
		border-radius: 4px;
		overflow: hidden;
		margin-bottom: 0.75rem;
	}

	.progress-fill {
		height: 100%;
		background: var(--accent);
		border-radius: 4px;
		transition: width 0.3s ease;
	}

	.progress-info {
		display: flex;
		justify-content: space-between;
		font-size: 0.9rem;
		margin-bottom: 0.5rem;
	}

	.progress-detail {
		display: flex;
		justify-content: space-between;
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	/* Done state */
	.done-summary {
		display: flex;
		gap: 2rem;
		margin: 1.5rem 0;
	}

	.done-stat {
		display: flex;
		flex-direction: column;
	}

	.done-value {
		font-size: 2rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.done-label {
		font-size: 0.8rem;
		color: var(--text-muted);
		text-transform: uppercase;
	}

	.done-hint {
		font-size: 0.9rem;
		color: var(--text-secondary);
		margin-bottom: 1.5rem;
	}

	.done-actions {
		display: flex;
		gap: 0.75rem;
	}
</style>
