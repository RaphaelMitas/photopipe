'use client';

import { useEffect, useRef, useState } from 'react';
import { formatBytes } from '@/lib/utils';

type SetKey = 'raw' | 'denoised' | 'rated' | 'selects' | 'exports';

type Props = {
	open: boolean;
	folderName: string;
	counts: Record<SetKey, number>;
	sizes: Record<SetKey, number>;
	onClose: () => void;
};

const SETS: readonly { key: SetKey; label: string }[] = [
	{ key: 'raw', label: 'Raw' },
	{ key: 'denoised', label: 'Denoised' },
	{ key: 'rated', label: 'Rated' },
	{ key: 'selects', label: 'Selects' },
	{ key: 'exports', label: 'Exports' }
];

const RATINGS = [1, 2, 3, 4, 5];

export function DownloadDialog({ open, folderName, counts, sizes, onClose }: Props) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const [selected, setSelected] = useState<Record<SetKey, boolean>>({
		raw: false,
		denoised: false,
		rated: false,
		selects: true,
		exports: true
	});
	const [keepStructure, setKeepStructure] = useState(true);
	const [minRating, setMinRating] = useState<number | null>(null);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	}, [open]);

	// close() from the effect above also fires `close`; only a dismissal by the
	// user (Escape) reaches this handler while the parent still considers it open.
	function handleClose() {
		if (open) onClose();
	}

	const chosen = SETS.filter((set) => selected[set.key]);
	const totalBytes = chosen.reduce((sum, set) => sum + sizes[set.key], 0);

	function toggle(key: SetKey) {
		setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
	}

	function download() {
		const include = chosen.map((set) => set.key).join(',');
		const params = `include=${include}&flat=${!keepStructure}`;
		const rating = minRating === null ? '' : `&minRating=${minRating}`;
		window.location.assign(
			`/api/shoots/${encodeURIComponent(folderName)}/download?${params}${rating}`
		);
		onClose();
	}

	return (
		<dialog
			ref={dialogRef}
			onClose={handleClose}
			className="border-line bg-surface text-ink m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border p-5 backdrop:bg-black/60"
		>
			<h2 className="text-sm font-semibold">Download</h2>
			<p className="text-ink-muted mt-0.5 font-mono text-xs">{folderName}</p>

			<div className="mt-4 space-y-1">
				{SETS.map((set) => (
					<label
						key={set.key}
						className="hover:bg-elevated flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5"
					>
						<input
							type="checkbox"
							checked={selected[set.key]}
							onChange={() => toggle(set.key)}
							className="accent-accent"
						/>
						<span className="text-sm">{set.label}</span>
						<span className="text-ink-muted ml-auto text-xs tabular-nums">
							{counts[set.key]} files · {formatBytes(sizes[set.key])}
						</span>
					</label>
				))}
			</div>

			<p className="text-ink-muted mt-2 text-xs">
				Rated and selects are views over the denoised files, not folders on disk — the ZIP creates
				them. Picking denoised together with rated or selects includes the overlapping files once
				per folder.
			</p>

			<div className="border-line mt-4 space-y-3 border-t pt-4">
				<label className="flex cursor-pointer items-center gap-3">
					<input
						type="checkbox"
						checked={keepStructure}
						onChange={() => setKeepStructure((prev) => !prev)}
						className="accent-accent"
					/>
					<span className="text-sm">Keep folder structure</span>
				</label>

				<div>
					<label className="field-label" htmlFor="download-min-rating">
						Minimum rating
					</label>
					<select
						id="download-min-rating"
						className="input"
						value={minRating === null ? '' : String(minRating)}
						onChange={(event) =>
							setMinRating(event.target.value === '' ? null : Number(event.target.value))
						}
					>
						<option value="">Any</option>
						{RATINGS.map((rating) => (
							<option key={rating} value={rating}>
								{rating}+ stars
							</option>
						))}
					</select>
					<p className="text-ink-muted mt-1 text-xs">Applies to the rated and selects sets only.</p>
				</div>
			</div>

			<div className="border-line mt-5 flex items-center justify-between gap-4 border-t pt-4">
				<span className="text-ink-secondary text-xs tabular-nums">
					Total {formatBytes(totalBytes)}
				</span>
				<div className="flex gap-2">
					<button type="button" className="btn-ghost btn-sm" onClick={onClose}>
						Cancel
					</button>
					<button
						type="button"
						className="btn-primary btn-sm"
						onClick={download}
						disabled={chosen.length === 0}
					>
						Download
					</button>
				</div>
			</div>
		</dialog>
	);
}
