<script lang="ts">
	import type { ShootDetail } from '$lib/types.js';
	import { formatBytes } from '$lib/utils.js';

	let {
		open,
		shoot,
		oncancel
	}: {
		open: boolean;
		shoot: ShootDetail;
		oncancel: () => void;
	} = $props();

	let includeRaw = $state(false);
	let includeDenoised = $state(false);
	let includeRated = $state(false);
	let includeSelects = $state(true);
	let includeExports = $state(true);
	let keepStructure = $state(true);

	let dialogEl: HTMLDialogElement | undefined = $state();

	$effect(() => {
		if (!dialogEl) return;
		if (open && !dialogEl.open) dialogEl.showModal();
		else if (!open && dialogEl.open) dialogEl.close();
	});

	let totalSize = $derived(
		(includeRaw ? shoot.rawSizeBytes : 0) +
			(includeDenoised ? shoot.dngSizeBytes : 0) +
			(includeRated ? shoot.ratedSizeBytes : 0) +
			(includeSelects ? shoot.selectSizeBytes : 0) +
			(includeExports ? shoot.exportSizeBytes : 0)
	);

	let anySelected = $derived(includeRaw || includeDenoised || includeRated || includeSelects || includeExports);

	function handleDownload() {
		const folders: string[] = [];
		if (includeRaw) folders.push('raw');
		if (includeDenoised) folders.push('denoised');
		if (includeRated) folders.push('rated');
		if (includeSelects) folders.push('selects');
		if (includeExports) folders.push('exports');

		if (folders.length === 0) return;

		const params = new URLSearchParams({
			include: folders.join(','),
			flat: keepStructure ? 'false' : 'true'
		});

		window.location.href = `/api/shoots/${encodeURIComponent(shoot.folderName)}/download?${params}`;
		oncancel();
	}
</script>

<dialog bind:this={dialogEl} onclose={oncancel}>
	<div class="content">
		<h3>Download</h3>
		<p class="hint">Select which files to include in the zip.</p>

		<div class="options">
			<label class="option">
				<input type="checkbox" bind:checked={includeRaw} />
				<div class="option-info">
					<span class="option-name">Raw ARWs</span>
					<span class="option-meta">{shoot.rawCount} file{shoot.rawCount !== 1 ? 's' : ''} &middot; {formatBytes(shoot.rawSizeBytes)}</span>
				</div>
			</label>

			<label class="option">
				<input type="checkbox" bind:checked={includeDenoised} />
				<div class="option-info">
					<span class="option-name">Denoised DNGs</span>
					<span class="option-meta">{shoot.dngCount} file{shoot.dngCount !== 1 ? 's' : ''} &middot; {formatBytes(shoot.dngSizeBytes)}</span>
				</div>
			</label>

			<label class="option">
				<input type="checkbox" bind:checked={includeRated} />
				<div class="option-info">
					<span class="option-name">Rated DNGs</span>
					<span class="option-meta">{shoot.ratedCount} file{shoot.ratedCount !== 1 ? 's' : ''} &middot; {formatBytes(shoot.ratedSizeBytes)}</span>
				</div>
			</label>

			<label class="option">
				<input type="checkbox" bind:checked={includeSelects} />
				<div class="option-info">
					<span class="option-name">Selects</span>
					<span class="option-meta">{shoot.selectCount} file{shoot.selectCount !== 1 ? 's' : ''} &middot; {formatBytes(shoot.selectSizeBytes)}</span>
				</div>
			</label>

			<label class="option">
				<input type="checkbox" bind:checked={includeExports} />
				<div class="option-info">
					<span class="option-name">Exports</span>
					<span class="option-meta">{shoot.exportCount} file{shoot.exportCount !== 1 ? 's' : ''} &middot; {formatBytes(shoot.exportSizeBytes)}</span>
				</div>
			</label>
		</div>

		<label class="toggle">
			<input type="checkbox" bind:checked={keepStructure} />
			<span>Keep folder structure</span>
		</label>

		{#if anySelected}
			<div class="total">
				Estimated size: <strong>{formatBytes(totalSize)}</strong>
			</div>
		{/if}

		<div class="actions">
			<button class="btn-ghost" onclick={oncancel}>Cancel</button>
			<button class="btn-primary" disabled={!anySelected} onclick={handleDownload}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
					<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
					<polyline points="7 10 12 15 17 10" />
					<line x1="12" y1="15" x2="12" y2="3" />
				</svg>
				Download
			</button>
		</div>
	</div>
</dialog>

<style>
	dialog {
		background: var(--bg-elevated);
		color: var(--text);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-lg);
		padding: 0;
		max-width: 420px;
		width: 90vw;
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5), 0 0 0 1px var(--border);
	}

	dialog::backdrop {
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
	}

	.content { padding: 1.5rem; }

	h3 { font-size: 1.05rem; font-weight: 600; margin-bottom: 0.25rem; }
	.hint { font-size: 0.8667rem; color: var(--text-muted); margin-bottom: 1.25rem; }

	.options { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem; }

	.option {
		display: flex; align-items: center; gap: 0.75rem;
		padding: 0.65rem 0.85rem; background: var(--bg-surface);
		border: 1px solid var(--border); border-radius: var(--radius-sm);
		cursor: pointer; transition: border-color 0.15s;
		font-size: inherit; font-weight: inherit; color: inherit;
	}
	.option:hover { border-color: var(--border-strong); }

	.option input[type='checkbox'] {
		width: 16px; height: 16px; accent-color: var(--accent);
		cursor: pointer; flex-shrink: 0; padding: 0; border-radius: 3px;
	}

	.option-info { display: flex; flex-direction: column; min-width: 0; }
	.option-name { font-size: 0.8667rem; font-weight: 500; }
	.option-meta { font-size: 0.75rem; color: var(--text-muted); }

	.toggle {
		display: flex; align-items: center; gap: 0.5rem;
		font-size: 0.8667rem; color: var(--text-secondary);
		cursor: pointer; margin-bottom: 1rem; font-weight: inherit;
	}
	.toggle input[type='checkbox'] {
		width: 14px; height: 14px; accent-color: var(--accent);
		cursor: pointer; padding: 0; border-radius: 3px;
	}

	.total { font-size: 0.8667rem; color: var(--text-muted); margin-bottom: 1.25rem; }
	.actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
</style>
