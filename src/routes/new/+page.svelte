<script lang="ts">
	import { goto } from '$app/navigation';
	import { formatBytes, slugifyName, buildFolderName } from '$lib/utils.js';

	const today = new Date().toISOString().split('T')[0];

	let name = $state('');
	let date = $state(today);
	let files = $state<File[]>([]);
	let error = $state('');

	let phase = $state<'form' | 'uploading' | 'done'>('form');
	let uploadedCount = $state(0);
	let uploadedBytes = $state(0);
	let currentFile = $state('');
	let failedFiles = $state<string[]>([]);
	let shootFolderName = $state('');

	const totalSize = $derived(files.reduce((sum, f) => sum + f.size, 0));
	const progress = $derived(files.length > 0 ? uploadedCount / files.length : 0);
	const folderPreview = $derived(
		name.trim() ? buildFolderName(name, date) : `${date}_shoot-name`
	);

	function handleFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files) addFiles(Array.from(input.files));
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		if (e.dataTransfer?.files) addFiles(Array.from(e.dataTransfer.files));
	}

	function addFiles(newFiles: File[]) {
		const arwFiles = newFiles.filter((f) => f.name.toLowerCase().endsWith('.arw'));
		const existing = new Set(files.map((f) => f.name));
		files = [...files, ...arwFiles.filter((f) => !existing.has(f.name))];
	}

	function removeFile(index: number) { files = files.filter((_, i) => i !== index); }
	function clearFiles() { files = []; }

	async function handleSubmit() {
		error = '';
		if (!name.trim()) { error = 'Shoot name is required'; return; }
		if (files.length === 0) { error = 'Select at least one ARW file'; return; }

		phase = 'uploading';
		try {
			const res = await fetch('/api/shoots', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: name.trim(), date })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({ message: 'Failed to create shoot' }));
				error = err.message || 'Failed to create shoot';
				phase = 'form'; return;
			}
			shootFolderName = (await res.json()).folderName;
		} catch { error = 'Connection failed'; phase = 'form'; return; }

		const BATCH = 3;
		for (let i = 0; i < files.length; i += BATCH) {
			const batch = files.slice(i, i + BATCH);
			const results = await Promise.allSettled(batch.map(async (file) => {
				currentFile = file.name;
				const fd = new FormData(); fd.append('file', file);
				const res = await fetch(`/api/upload/${encodeURIComponent(shootFolderName)}`, { method: 'POST', body: fd });
				if (!res.ok) throw new Error(file.name);
				return file;
			}));
			for (const r of results) {
				if (r.status === 'fulfilled') { uploadedCount++; uploadedBytes += r.value.size; }
				else { failedFiles = [...failedFiles, batch[results.indexOf(r)]?.name ?? '?']; }
			}
		}

		await fetch(`/api/upload/${encodeURIComponent(shootFolderName)}`, { method: 'PATCH' });
		currentFile = '';
		phase = 'done';
	}
</script>

<div class="page">
	<a href="/" class="back">
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
		Back
	</a>

	{#if phase === 'form'}
		<h1>New Shoot</h1>
		<p class="desc">Name your shoot, drop your ARW files, and upload everything at once.</p>

		{#if error}<div class="alert alert-error">{error}</div>{/if}

		<div class="form-row">
			<div class="field grow">
				<label for="name">Shoot name</label>
				<input type="text" id="name" bind:value={name} placeholder="Spring Concert" />
			</div>
			<div class="field">
				<label for="date">Date</label>
				<input type="date" id="date" bind:value={date} />
			</div>
		</div>

		<div class="folder-preview">
			<span class="folder-label">Folder</span>
			<code>{folderPreview}/</code>
		</div>

		<div class="drop" ondragover={(e) => e.preventDefault()} ondrop={handleDrop} role="region" aria-label="File drop zone">
			<div class="drop-inner">
				<div class="drop-icon">
					<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
						<polyline points="17 8 12 3 7 8"/>
						<line x1="12" y1="3" x2="12" y2="15"/>
					</svg>
				</div>
				<p class="drop-title">Drop ARW files here</p>
				<p class="drop-sub">or browse to select</p>
				<div class="drop-btns">
					<label class="btn-ghost drop-btn">
						Select Files
						<input type="file" accept=".arw,.ARW" multiple onchange={handleFileSelect} hidden />
					</label>
					<label class="btn-ghost drop-btn">
						Select Folder
						<input type="file" onchange={handleFileSelect} hidden webkitdirectory />
					</label>
				</div>
			</div>
		</div>

		{#if files.length > 0}
			<div class="file-bar">
				<span><strong>{files.length}</strong> file{files.length !== 1 ? 's' : ''} <span class="muted">&middot; {formatBytes(totalSize)}</span></span>
				<button class="btn-ghost btn-xs" onclick={clearFiles}>Clear all</button>
			</div>

			<div class="file-list">
				{#each files as file, i (file.name)}
					<div class="file-row">
						<span class="fname">{file.name}</span>
						<span class="fsize">{formatBytes(file.size)}</span>
						<button class="fremove" onclick={() => removeFile(i)}>&times;</button>
					</div>
				{/each}
			</div>
		{/if}

		<button class="btn-primary btn-lg" onclick={handleSubmit} disabled={!name.trim() || files.length === 0}>
			Create & Upload {files.length} File{files.length !== 1 ? 's' : ''}
		</button>

	{:else if phase === 'uploading'}
		<h1>Uploading...</h1>
		<p class="desc">Transferring files to the server.</p>

		<div class="upload-card">
			<div class="pbar-track"><div class="pbar-fill" style="width: {progress * 100}%"></div></div>
			<div class="upload-row">
				<span>{uploadedCount} / {files.length} files</span>
				<span class="accent">{Math.round(progress * 100)}%</span>
			</div>
			{#if currentFile}<p class="upload-current"><code>{currentFile}</code></p>{/if}
			<p class="muted">{formatBytes(uploadedBytes)} transferred</p>
		</div>

	{:else}
		<h1>Upload Complete</h1>

		<div class="done-stats">
			<div class="dstat">
				<span class="dval">{uploadedCount}</span>
				<span class="dkey">files uploaded</span>
			</div>
			<div class="dstat">
				<span class="dval">{formatBytes(uploadedBytes)}</span>
				<span class="dkey">total size</span>
			</div>
		</div>

		{#if failedFiles.length > 0}
			<div class="alert alert-error">{failedFiles.length} file{failedFiles.length !== 1 ? 's' : ''} failed: {failedFiles.join(', ')}</div>
		{/if}

		<p class="done-hint">Now open PureRAW on bean.local and process <code>raw/</code> &rarr; <code>denoised/</code></p>

		<div class="done-actions">
			<a href="/shoot/{encodeURIComponent(shootFolderName)}" class="btn-primary">View Shoot</a>
			<a href="/" class="btn-ghost">Dashboard</a>
		</div>
	{/if}
</div>

<style>
	.page { max-width: 560px; }

	.back {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.8667rem;
		color: var(--text-muted);
		margin-bottom: 2rem;
	}
	.back:hover { color: var(--text); }

	h1 {
		font-size: 1.6rem;
		font-weight: 700;
		letter-spacing: -0.03em;
		margin-bottom: 0.25rem;
	}

	.desc {
		font-size: 0.8667rem;
		color: var(--text-muted);
		margin-bottom: 1.75rem;
	}

	/* Form */
	.form-row {
		display: flex;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}
	.grow { flex: 1; }

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	input { width: 100%; }

	.folder-preview {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.55rem 0.85rem;
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		margin-bottom: 1.75rem;
		font-size: 0.8667rem;
	}
	.folder-label { font-size: 0.75rem; color: var(--text-muted); font-weight: 500; }

	/* Drop zone */
	.drop {
		border: 2px dashed rgba(255, 255, 255, 0.08);
		border-radius: var(--radius-sm);
		padding: 2.5rem 2rem;
		text-align: center;
		transition: all 0.2s;
		margin-bottom: 1.25rem;
		background: var(--bg-surface);
	}
	.drop:hover {
		border-color: var(--accent);
		background: var(--accent-glow);
	}
	.drop-inner { display: flex; flex-direction: column; align-items: center; gap: 0.4rem; }
	.drop-icon { color: var(--text-muted); margin-bottom: 0.25rem; }
	.drop:hover .drop-icon { color: var(--accent-light); }
	.drop-title { font-weight: 500; font-size: 0.9333rem; }
	.drop-sub { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem; }
	.drop-btns { display: flex; gap: 0.5rem; }
	.drop-btn { cursor: pointer; font-size: 0.8rem; padding: 0.35rem 0.65rem; }

	/* File list */
	.file-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.5rem;
		font-size: 0.8667rem;
	}
	.muted { color: var(--text-muted); }

	.file-list {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		max-height: 220px;
		overflow-y: auto;
		margin-bottom: 1.5rem;
	}
	.file-row {
		display: flex;
		align-items: center;
		padding: 0.4rem 0.75rem;
		font-size: 0.8rem;
		border-bottom: 1px solid var(--border-subtle);
	}
	.file-row:last-child { border-bottom: none; }
	.fname {
		flex: 1;
		font-family: var(--font-mono);
		font-size: 0.8rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-secondary);
	}
	.fsize { color: var(--text-muted); margin: 0 0.5rem; font-variant-numeric: tabular-nums; font-size: 0.8rem; }
	.fremove {
		background: none; color: var(--text-muted); padding: 0 0.2rem;
		font-size: 1rem; line-height: 1;
	}
	.fremove:hover { color: var(--red); }

	/* Upload */
	.upload-card {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 1.25rem;
		margin-top: 1.5rem;
	}
	.pbar-track {
		height: 6px;
		background: var(--bg-active);
		border-radius: 3px;
		overflow: hidden;
		margin-bottom: 1rem;
	}
	.pbar-fill {
		height: 100%;
		background: linear-gradient(90deg, var(--accent), var(--pink));
		border-radius: 3px;
		transition: width 0.3s ease;
		box-shadow: 0 0 12px var(--accent-glow-strong);
	}
	.upload-row {
		display: flex;
		justify-content: space-between;
		font-size: 0.9rem;
		margin-bottom: 0.5rem;
	}
	.accent { color: var(--accent-light); font-weight: 600; }
	.upload-current { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.25rem; }

	/* Done */
	.done-stats { display: flex; gap: 3rem; margin: 2rem 0; }
	.dstat { display: flex; flex-direction: column; }
	.dval {
		font-size: 2.25rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.03em;
		line-height: 1;
		background: linear-gradient(135deg, var(--accent-light), var(--pink));
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}
	.dkey { font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem; }
	.done-hint { font-size: 0.8667rem; color: var(--text-secondary); margin-bottom: 1.75rem; }
	.done-actions { display: flex; gap: 0.75rem; }
</style>
