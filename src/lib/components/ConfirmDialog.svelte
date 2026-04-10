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
		if (open && !dialogEl.open) dialogEl.showModal();
		else if (!open && dialogEl.open) dialogEl.close();
	});
</script>

<dialog bind:this={dialogEl} onclose={oncancel}>
	<div class="content">
		<h3>{title}</h3>
		<p>{message}</p>
		<div class="actions">
			<button class="btn-ghost" onclick={oncancel}>Cancel</button>
			<button class="btn-danger" onclick={onconfirm}>{confirmLabel}</button>
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

	h3 {
		font-size: 1.05rem;
		font-weight: 600;
		margin-bottom: 0.5rem;
	}

	p {
		font-size: 0.8667rem;
		color: var(--text-secondary);
		line-height: 1.6;
		margin-bottom: 1.5rem;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
</style>
