'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { finalizeUpload, shootKey, uploadFile } from '@/lib/api';
import { formatBytes, fileExtension } from '@/lib/utils';
import { STAGE_ACCEPT } from '@/lib/stages';
import type { PhysicalStage } from '@/lib/types';

/** Concurrency that keeps the pipe full without thrashing the disk. */
const BATCH = 3;

export function UploadPanel({
	folderName,
	stage,
	allowStageChange = false
}: {
	folderName: string;
	stage: PhysicalStage;
	allowStageChange?: boolean;
}) {
	const queryClient = useQueryClient();
	const inputRef = useRef<HTMLInputElement>(null);

	const [target, setTarget] = useState<PhysicalStage>(stage);
	const [queue, setQueue] = useState<File[]>([]);
	const [uploading, setUploading] = useState(false);
	const [done, setDone] = useState(0);
	const [warning, setWarning] = useState('');
	const [failed, setFailed] = useState<string[]>([]);

	const accept = STAGE_ACCEPT[target];

	function addFiles(incoming: File[]) {
		const allowed = new Set(accept);
		const existing = new Set(queue.map((f) => f.name));
		const accepted: File[] = [];
		const rejected: string[] = [];

		for (const file of incoming) {
			if (existing.has(file.name)) continue;
			if (allowed.has(fileExtension(file.name))) accepted.push(file);
			else rejected.push(file.name);
		}

		setQueue((prev) => [...prev, ...accepted]);
		setWarning(
			rejected.length > 0
				? `${rejected.length} file${rejected.length === 1 ? '' : 's'} skipped. ${target}/ accepts ${accept.join(', ')}`
				: ''
		);
	}

	async function startUpload() {
		if (queue.length === 0) return;
		setUploading(true);
		setDone(0);
		setFailed([]);

		const failures: string[] = [];
		for (let i = 0; i < queue.length; i += BATCH) {
			const chunk = queue.slice(i, i + BATCH);
			await Promise.all(
				chunk.map(async (file) => {
					try {
						await uploadFile(folderName, target, file);
					} catch {
						failures.push(file.name);
					} finally {
						setDone((n) => n + 1);
					}
				})
			);
		}

		if (target === 'raw') await finalizeUpload(folderName).catch(() => {});

		setFailed(failures);
		setQueue(failures.length > 0 ? queue.filter((f) => failures.includes(f.name)) : []);
		setUploading(false);
		queryClient.invalidateQueries({ queryKey: shootKey(folderName) });
	}

	const totalBytes = queue.reduce((sum, f) => sum + f.size, 0);

	return (
		<div className="card space-y-3">
			{allowStageChange && (
				<div className="max-w-40">
					<label className="field-label" htmlFor="upload-target">
						Target folder
					</label>
					<select
						id="upload-target"
						className="input"
						value={target}
						onChange={(e) => setTarget(e.target.value as PhysicalStage)}
						disabled={uploading}
					>
						<option value="raw">raw</option>
						<option value="denoised">denoised</option>
						<option value="exports">exports</option>
					</select>
				</div>
			)}

			<div
				onDragOver={(e) => e.preventDefault()}
				onDrop={(e) => {
					e.preventDefault();
					addFiles(Array.from(e.dataTransfer.files));
				}}
				className="border-line-strong text-ink-muted hover:border-accent flex items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-6 text-sm transition-colors"
			>
				<span>Drop files or</span>
				<button
					type="button"
					className="btn-ghost btn-sm"
					onClick={() => inputRef.current?.click()}
				>
					Browse
				</button>
				<input
					ref={inputRef}
					type="file"
					multiple
					accept={accept.join(',')}
					hidden
					onChange={(e) => {
						addFiles(Array.from(e.target.files ?? []));
						e.target.value = '';
					}}
				/>
			</div>

			<p className="text-ink-muted text-[11px]">
				Accepted in {target}/: {accept.join(', ')}
			</p>

			{warning && <p className="text-warn text-xs">{warning}</p>}
			{failed.length > 0 && !uploading && (
				<p className="text-bad text-xs">
					{failed.length} upload{failed.length === 1 ? '' : 's'} failed — still queued, try again.
				</p>
			)}

			{queue.length > 0 && (
				<>
					<div className="divide-border-subtle border-line max-h-40 divide-y overflow-y-auto rounded-md border">
						{queue.map((file, i) => (
							<div key={file.name} className="flex items-center gap-2 px-3 py-1.5 text-xs">
								<span className="text-ink-secondary flex-1 truncate font-mono">{file.name}</span>
								<span className="text-ink-muted tabular-nums">{formatBytes(file.size)}</span>
								{!uploading && (
									<button
										type="button"
										onClick={() => setQueue((prev) => prev.filter((_, idx) => idx !== i))}
										className="text-ink-muted hover:text-bad"
										aria-label={`Remove ${file.name}`}
									>
										×
									</button>
								)}
							</div>
						))}
					</div>

					{uploading ? (
						<div className="flex items-center gap-3">
							<div className="bg-active h-1 flex-1 overflow-hidden rounded-full">
								<div
									className="bg-accent h-full transition-[width] duration-300"
									style={{ width: `${(done / queue.length) * 100}%` }}
								/>
							</div>
							<span className="text-ink-muted text-xs tabular-nums">
								{done} / {queue.length}
							</span>
						</div>
					) : (
						<button type="button" className="btn-primary btn-sm" onClick={startUpload}>
							Upload {queue.length} file{queue.length === 1 ? '' : 's'} ({formatBytes(totalBytes)})
						</button>
					)}
				</>
			)}
		</div>
	);
}
