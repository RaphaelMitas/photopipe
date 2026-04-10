<script lang="ts">
	let {
		open,
		title,
		message,
		confirmLabel = 'Confirm',
		onconfirm,
		oncancel
	}: {
		open: boolean;
		title: string;
		message: string;
		confirmLabel?: string;
		onconfirm: () => void;
		oncancel: () => void;
	} = $props();

	let dialogEl: HTMLDialogElement | undefined = $state();

	$effect(() => {
		if (!dialogEl) return;
		if (open && !dialogEl.open) {
			dialogEl.showModal();
		} else if (!open && dialogEl.open) {
			dialogEl.close();
		}
	});

	function handleClose() {
		oncancel();
	}
</script>

<dialog bind:this={dialogEl} onclose={handleClose}>
	<div class="dialog-content">
		<h3>{title}</h3>
		<p>{message}</p>
		<div class="dialog-actions">
			<button class="btn-ghost" onclick={oncancel}>Cancel</button>
			<button class="btn-danger" onclick={onconfirm}>{confirmLabel}</button>
		</div>
	</div>
</dialog>

<style>
	dialog {
		background: var(--bg-secondary);
		color: var(--text-primary);
		border: 1px solid var(--border-light);
		border-radius: var(--radius-lg);
		padding: 0;
		max-width: 420px;
		width: 90vw;
		box-shadow: var(--shadow-lg);
	}

	dialog::backdrop {
		background: rgba(0, 0, 0, 0.7);
	}

	.dialog-content {
		padding: 1.5rem;
	}

	h3 {
		font-size: 1.1rem;
		font-weight: 600;
		margin-bottom: 0.5rem;
	}

	p {
		font-size: 0.9rem;
		color: var(--text-secondary);
		line-height: 1.5;
		margin-bottom: 1.5rem;
	}

	.dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
</style>
