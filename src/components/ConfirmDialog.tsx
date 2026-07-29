'use client';

import { useEffect, useRef } from 'react';

type Props = {
	open: boolean;
	title: string;
	message: string;
	confirmLabel?: string;
	busy?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
};

export function ConfirmDialog({
	open,
	title,
	message,
	confirmLabel = 'Confirm',
	busy = false,
	onConfirm,
	onCancel
}: Props) {
	const dialogRef = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	}, [open]);

	// close() from the effect above also fires `close`; only a dismissal by the
	// user (Escape) reaches this handler while the parent still considers it open.
	function handleClose() {
		if (open) onCancel();
	}

	return (
		<dialog
			ref={dialogRef}
			onClose={handleClose}
			className="border-line bg-surface text-ink m-auto w-[calc(100%-2rem)] max-w-sm rounded-lg border p-5 backdrop:bg-black/60"
		>
			<h2 className="text-sm font-semibold">{title}</h2>
			<p className="text-ink-secondary mt-2 text-sm">{message}</p>

			<div className="mt-5 flex justify-end gap-2">
				<button type="button" className="btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
					Cancel
				</button>
				<button type="button" className="btn-danger btn-sm" onClick={onConfirm} disabled={busy}>
					{confirmLabel}
				</button>
			</div>
		</dialog>
	);
}
