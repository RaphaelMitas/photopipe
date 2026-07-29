'use client';

import { useState } from 'react';
import { StarRating } from './StarRating';
import { thumbUrl } from '@/lib/api';
import { formatBytes } from '@/lib/utils';
import type { FileInfo, StarRating as Stars } from '@/lib/types';

export function Gallery({
	folderName,
	files,
	onOpen,
	onRate,
	onToggleSelect,
	onDelete,
	onBulkSelect
}: {
	folderName: string;
	files: FileInfo[];
	onOpen: (fileName: string) => void;
	onRate?: (fileName: string, rating: Stars | null) => void;
	onToggleSelect?: (fileName: string, isSelect: boolean) => void;
	onDelete?: (fileName: string) => void;
	onBulkSelect?: (fileNames: string[], isSelect: boolean) => void;
}) {
	const [checked, setChecked] = useState<Set<string>>(new Set());
	const [checkedAgainst, setCheckedAgainst] = useState(files.length);

	// A file list that changed underneath us makes the old selection meaningless.
	if (checkedAgainst !== files.length) {
		setCheckedAgainst(files.length);
		setChecked(new Set());
	}

	function toggleChecked(name: string) {
		setChecked((prev) => {
			const next = new Set(prev);
			if (next.has(name)) next.delete(name);
			else next.add(name);
			return next;
		});
	}

	const allChecked = files.length > 0 && files.every((f) => checked.has(f.name));

	if (files.length === 0) {
		return <p className="text-ink-muted py-12 text-center text-sm">Nothing here yet.</p>;
	}

	return (
		<div className="space-y-3">
			{onBulkSelect && (
				<div className="flex flex-wrap items-center gap-2 text-xs">
					<button
						type="button"
						className="btn-ghost btn-sm"
						onClick={() => setChecked(allChecked ? new Set() : new Set(files.map((f) => f.name)))}
					>
						{allChecked ? 'Clear' : 'Select all'}
					</button>
					{checked.size > 0 && (
						<>
							<span className="text-ink-muted">{checked.size} checked</span>
							<button
								type="button"
								className="btn-ghost btn-sm"
								onClick={() => {
									onBulkSelect(Array.from(checked), true);
									setChecked(new Set());
								}}
							>
								Mark as selects
							</button>
							<button
								type="button"
								className="btn-ghost btn-sm"
								onClick={() => {
									onBulkSelect(Array.from(checked), false);
									setChecked(new Set());
								}}
							>
								Unmark
							</button>
						</>
					)}
				</div>
			)}

			<div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
				{files.map((file) => (
					<figure
						key={file.name}
						className={`group bg-surface overflow-hidden rounded-md border transition-colors ${
							checked.has(file.name) ? 'border-accent' : 'border-line hover:border-line-strong'
						}`}
					>
						<div className="relative">
							<button
								type="button"
								onClick={() => (checked.size > 0 ? toggleChecked(file.name) : onOpen(file.name))}
								className="block w-full"
								aria-label={`Open ${file.name}`}
							>
								{/* eslint-disable-next-line @next/next/no-img-element */}
								<img
									src={thumbUrl(folderName, file.stage, file.name)}
									alt={file.name}
									loading="lazy"
									className="bg-elevated aspect-square w-full object-cover"
								/>
							</button>

							{onBulkSelect && (
								<label className="absolute top-1.5 left-1.5 flex cursor-pointer items-center opacity-0 transition-opacity group-hover:opacity-100 has-checked:opacity-100">
									<input
										type="checkbox"
										checked={checked.has(file.name)}
										onChange={() => toggleChecked(file.name)}
										className="accent-accent h-4 w-4"
										aria-label={`Check ${file.name}`}
									/>
								</label>
							)}

							{onToggleSelect && (
								<button
									type="button"
									onClick={() => onToggleSelect(file.name, !file.isSelect)}
									title={file.isSelect ? 'Remove from selects' : 'Mark as select'}
									className={`absolute top-1.5 right-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-opacity ${
										file.isSelect
											? 'bg-pick/90 text-white'
											: 'text-ink-secondary bg-black/60 opacity-0 group-hover:opacity-100'
									}`}
								>
									★
								</button>
							)}

							{onDelete && (
								<button
									type="button"
									onClick={() => onDelete(file.name)}
									title="Delete"
									className="text-ink-secondary hover:text-bad absolute right-1.5 bottom-1.5 rounded bg-black/60 px-1.5 text-sm opacity-0 transition-opacity group-hover:opacity-100"
								>
									×
								</button>
							)}
						</div>

						<figcaption className="space-y-1 px-2 py-1.5">
							<div className="flex items-center justify-between gap-1">
								{onRate ? (
									<StarRating
										value={file.rating}
										size="sm"
										onChange={(rating) => onRate(file.name, rating)}
									/>
								) : (
									<StarRating value={file.rating} size="sm" readOnly />
								)}
								<span className="text-ink-muted shrink-0 text-[10px] tabular-nums">
									{formatBytes(file.sizeBytes)}
								</span>
							</div>
							<p className="text-ink-muted truncate font-mono text-[10px]" title={file.name}>
								{file.name}
							</p>
						</figcaption>
					</figure>
				))}
			</div>
		</div>
	);
}
