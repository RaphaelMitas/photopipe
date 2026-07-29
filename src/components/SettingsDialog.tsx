'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { DenoiseAlgorithm } from '@/lib/types';
import { formatBytes } from '@/lib/utils';

type Props = {
	open: boolean;
	folderName: string;
	algorithm: DenoiseAlgorithm | null;
	notes: string;
	totalSizeBytes: number;
	onClose: () => void;
	onSaved: () => void;
	onDeleteShoot: () => void;
};

const ALGORITHMS: readonly DenoiseAlgorithm[] = ['DeepPRIME 3', 'DeepPRIME XD3'];

function parseAlgorithm(value: string): DenoiseAlgorithm | null {
	return value === 'DeepPRIME 3' || value === 'DeepPRIME XD3' ? value : null;
}

export function SettingsDialog({
	open,
	folderName,
	algorithm,
	notes,
	totalSizeBytes,
	onClose,
	onSaved,
	onDeleteShoot
}: Props) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const [algorithmValue, setAlgorithmValue] = useState<DenoiseAlgorithm | null>(algorithm);
	const [notesValue, setNotesValue] = useState(notes);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	}, [open]);

	// Reopening discards an abandoned edit and picks up whatever the parent has now.
	const [seededWhileOpen, setSeededWhileOpen] = useState(open);
	if (open !== seededWhileOpen) {
		setSeededWhileOpen(open);
		if (open) {
			setAlgorithmValue(algorithm);
			setNotesValue(notes);
			setError(null);
		}
	}

	// close() from the effect above also fires `close`; only a dismissal by the
	// user (Escape) reaches this handler while the parent still considers it open.
	function handleClose() {
		if (open) onClose();
	}

	async function save(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setSaving(true);
		setError(null);
		try {
			const response = await fetch(`/api/shoots/${encodeURIComponent(folderName)}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ algorithm: algorithmValue, notes: notesValue })
			});
			if (!response.ok) {
				setError('Could not save settings. Please try again.');
				return;
			}
			onSaved();
			onClose();
		} catch {
			setError('Could not reach the server.');
		} finally {
			setSaving(false);
		}
	}

	return (
		<dialog
			ref={dialogRef}
			onClose={handleClose}
			className="border-line bg-surface text-ink m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border p-5 backdrop:bg-black/60"
		>
			<h2 className="text-sm font-semibold">Shoot settings</h2>
			<p className="text-ink-muted mt-0.5 font-mono text-xs">{folderName}</p>
			<p className="text-ink-muted mt-0.5 text-xs tabular-nums">
				{formatBytes(totalSizeBytes)} on disk
			</p>

			<form onSubmit={save} className="mt-4 space-y-4">
				<div>
					<label className="field-label" htmlFor="settings-algorithm">
						Denoise algorithm
					</label>
					<select
						id="settings-algorithm"
						className="input"
						value={algorithmValue ?? ''}
						onChange={(event) => setAlgorithmValue(parseAlgorithm(event.target.value))}
					>
						<option value="">Not set</option>
						{ALGORITHMS.map((option) => (
							<option key={option} value={option}>
								{option}
							</option>
						))}
					</select>
				</div>

				<div>
					<label className="field-label" htmlFor="settings-notes">
						Notes
					</label>
					<textarea
						id="settings-notes"
						className="input min-h-24 resize-y"
						value={notesValue}
						onChange={(event) => setNotesValue(event.target.value)}
						placeholder="Lens, lighting, client, anything worth remembering."
					/>
				</div>

				{error && <p className="text-bad text-xs">{error}</p>}

				<div className="flex justify-end gap-2">
					<button type="button" className="btn-ghost btn-sm" onClick={onClose} disabled={saving}>
						Cancel
					</button>
					<button type="submit" className="btn-primary btn-sm" disabled={saving}>
						{saving ? 'Saving…' : 'Save'}
					</button>
				</div>
			</form>

			<div className="border-line mt-5 border-t pt-4">
				<h3 className="text-bad text-xs font-medium">Danger zone</h3>
				<div className="mt-2 flex items-center justify-between gap-4">
					<p className="text-ink-muted text-xs">
						Deletes the shoot folder and every file inside it.
					</p>
					<button type="button" className="btn-danger btn-sm shrink-0" onClick={onDeleteShoot}>
						Delete shoot
					</button>
				</div>
			</div>
		</dialog>
	);
}
