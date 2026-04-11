<script lang="ts">
	import type { ShootDetail } from '$lib/types.js';
	import { formatBytes } from '$lib/utils.js';
	import Checkbox from './Checkbox.svelte';

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
			<div class="option" onclick={() => (includeRaw = !includeRaw)} role="button" tabindex="0" onkeydown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); includeRaw = !includeRaw; } }}>
				<Checkbox checked={includeRaw} onchange={(v) => (includeRaw = v)} />
				<div class="option-info">
					<span class="option-name">Raw ARWs</span>
					<span class="option-meta">{shoot.rawCount} file{shoot.rawCount !== 1 ? 's' : ''} &middot; {formatBytes(shoot.rawSizeBytes)}</span>
				</div>
			</div>

			<div class="option" onclick={() => (includeDenoised = !includeDenoised)} role="button" tabindex="0" onkeydown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); includeDenoised = !includeDenoised; } }}>
				<Checkbox checked={includeDenoised} onchange={(v) => (includeDenoised = v)} />
				<div class="option-info">
					<span class="option-name">Denoised DNGs</span>
					<span class="option-meta">{shoot.dngCount} file{shoot.dngCount !== 1 ? 's' : ''} &middot; {formatBytes(shoot.dngSizeBytes)}</span>
				</div>
			</div>

			<div class="option" onclick={() => (includeRated = !includeRated)} role="button" tabindex="0" onkeydown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); includeRated = !includeRated; } }}>
				<Checkbox checked={includeRated} onchange={(v) => (includeRated = v)} />
				<div class="option-info">
					<span class="option-name">Rated DNGs</span>
					<span class="option-meta">{shoot.ratedCount} file{shoot.ratedCount !== 1 ? 's' : ''} &middot; {formatBytes(shoot.ratedSizeBytes)}</span>
				</div>
			</div>

			<div class="option" onclick={() => (includeSelects = !includeSelects)} role="button" tabindex="0" onkeydown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); includeSelects = !includeSelects; } }}>
				<Checkbox checked={includeSelects} onchange={(v) => (includeSelects = v)} />
				<div class="option-info">
					<span class="option-name">Selects</span>
					<span class="option-meta">{shoot.selectCount} file{shoot.selectCount !== 1 ? 's' : ''} &middot; {formatBytes(shoot.selectSizeBytes)}</span>
				</div>
			</div>

			<div class="option" onclick={() => (includeExports = !includeExports)} role="button" tabindex="0" onkeydown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); includeExports = !includeExports; } }}>
				<Checkbox checked={includeExports} onchange={(v) => (includeExports = v)} />
				<div class="option-info">
					<span class="option-name">Exports</span>
					<span class="option-meta">{shoot.exportCount} file{shoot.exportCount !== 1 ? 's' : ''} &middot; {formatBytes(shoot.exportSizeBytes)}</span>
				</div>
			</div>
		</div>

		<div class="toggle" onclick={() => (keepStructure = !keepStructure)} role="button" tabindex="0" onkeydown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); keepStructure = !keepStructure; } }}>
			<Checkbox checked={keepStructure} onchange={(v) => (keepStructure = v)} />
			<span>Keep folder structure</span>
		</div>

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
		outline: none;
	}
	.option:hover, .option:focus-visible { border-color: var(--border-strong); }

	.option-info { display: flex; flex-direction: column; min-width: 0; }
	.option-name { font-size: 0.8667rem; font-weight: 500; }
	.option-meta { font-size: 0.75rem; color: var(--text-muted); }

	.toggle {
		display: flex; align-items: center; gap: 0.5rem;
		font-size: 0.8667rem; color: var(--text-secondary);
		cursor: pointer; margin-bottom: 1rem; font-weight: inherit;
		outline: none;
	}

	.total { font-size: 0.8667rem; color: var(--text-muted); margin-bottom: 1.25rem; }
	.actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
</style>
