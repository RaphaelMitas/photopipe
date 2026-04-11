<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ShootDetail } from '$lib/types.js';
	import { formatBytes } from '$lib/utils.js';

	let {
		open,
		shoot,
		formResult,
		oncancel,
		ondeleteproject
	}: {
		open: boolean;
		shoot: ShootDetail;
		formResult: { success?: boolean; error?: string } | null;
		oncancel: () => void;
		ondeleteproject: () => void;
	} = $props();

	let dialogEl: HTMLDialogElement | undefined = $state();
	let showDeleteConfirm = $state(false);

	$effect(() => {
		if (!dialogEl) return;
		if (open && !dialogEl.open) {
			showDeleteConfirm = false;
			dialogEl.showModal();
		} else if (!open && dialogEl.open) {
			dialogEl.close();
		}
	});
</script>

<dialog bind:this={dialogEl} onclose={oncancel}>
	<div class="content">
		<h3>Project Settings</h3>

		{#if formResult?.success}<div class="alert alert-success">Saved.</div>{/if}
		{#if formResult?.error}<div class="alert alert-error">{formResult.error}</div>{/if}

		<form method="POST" action="?/updateMeta" use:enhance>
			<div class="fields">
				<div class="field">
					<label for="s-algorithm">Algorithm</label>
					<select id="s-algorithm" name="algorithm">
						<option value="">Not set</option>
						<option value="DeepPRIME 3" selected={shoot.metadata.algorithm === 'DeepPRIME 3'}>DeepPRIME 3</option>
						<option value="DeepPRIME XD3" selected={shoot.metadata.algorithm === 'DeepPRIME XD3'}>DeepPRIME XD3</option>
					</select>
				</div>
				<div class="field">
					<label for="s-notes">Notes</label>
					<textarea id="s-notes" name="notes" rows="3" placeholder="Low light venue, ISO 6400...">{shoot.metadata.notes}</textarea>
				</div>
			</div>
			<button type="submit" class="btn-primary btn-sm">Save</button>
		</form>

		<div class="danger-zone">
			<h4>Danger Zone</h4>
			{#if !showDeleteConfirm}
				<button class="btn-danger btn-sm" onclick={() => (showDeleteConfirm = true)}>
					Delete Project
				</button>
			{:else}
				<p class="danger-msg">
					Delete <strong>{shoot.name}</strong> and all files ({formatBytes(shoot.totalSizeBytes)})? This cannot be undone.
				</p>
				<div class="danger-actions">
					<button class="btn-ghost btn-sm" onclick={() => (showDeleteConfirm = false)}>Cancel</button>
					<button class="btn-danger btn-sm" onclick={ondeleteproject}>Delete Everything</button>
				</div>
			{/if}
		</div>

		<div class="close-row">
			<button class="btn-ghost btn-sm" onclick={oncancel}>Close</button>
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
		max-width: 440px;
		width: 90vw;
		box-shadow:
			0 16px 48px rgba(0, 0, 0, 0.5),
			0 0 0 1px var(--border);
	}

	dialog::backdrop {
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
	}

	.content {
		padding: 1.5rem;
	}

	h3 {
		font-size: 1.05rem;
		font-weight: 600;
		margin-bottom: 1rem;
	}

	.fields {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		margin-bottom: 1rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	select, textarea {
		width: 100%;
	}

	.danger-zone {
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}

	h4 {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--red);
		margin-bottom: 0.75rem;
	}

	.danger-msg {
		font-size: 0.8667rem;
		color: var(--text-secondary);
		margin-bottom: 0.75rem;
	}

	.danger-actions {
		display: flex;
		gap: 0.5rem;
	}

	.close-row {
		margin-top: 1.25rem;
		display: flex;
		justify-content: flex-end;
	}
</style>
