'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createShoot, finalizeUpload, uploadFile } from '@/lib/api';
import { buildFolderName, formatBytes } from '@/lib/utils';

const BATCH = 3;

export default function NewShootPage() {
	const router = useRouter();
	const today = new Date().toISOString().slice(0, 10);

	const [name, setName] = useState('');
	const [date, setDate] = useState(today);
	const [files, setFiles] = useState<File[]>([]);
	const [error, setError] = useState('');
	const [phase, setPhase] = useState<'form' | 'uploading'>('form');
	const [done, setDone] = useState(0);

	const folderPreview = name.trim() ? buildFolderName(name, date) : `${date}_shoot-name`;
	const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

	function addFiles(incoming: File[]) {
		const arws = incoming.filter((f) => f.name.toLowerCase().endsWith('.arw'));
		const existing = new Set(files.map((f) => f.name));
		setFiles((prev) => [...prev, ...arws.filter((f) => !existing.has(f.name))]);
	}

	async function submit() {
		setError('');
		if (!name.trim()) return setError('Shoot name is required');

		setPhase('uploading');
		let folderName: string;
		try {
			({ folderName } = await createShoot(name.trim(), date));
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to create shoot');
			setPhase('form');
			return;
		}

		for (let i = 0; i < files.length; i += BATCH) {
			await Promise.all(
				files.slice(i, i + BATCH).map(async (file) => {
					await uploadFile(folderName, 'raw', file).catch(() => {});
					setDone((n) => n + 1);
				})
			);
		}

		if (files.length > 0) await finalizeUpload(folderName).catch(() => {});
		router.push(`/shoot/${encodeURIComponent(folderName)}`);
	}

	if (phase === 'uploading') {
		return (
			<div className="mx-auto max-w-md py-16 text-center">
				<p className="text-sm font-medium">Creating shoot…</p>
				<div className="bg-active mt-4 h-1 overflow-hidden rounded-full">
					<div
						className="bg-accent h-full transition-[width] duration-300"
						style={{ width: `${files.length ? (done / files.length) * 100 : 100}%` }}
					/>
				</div>
				<p className="text-ink-muted mt-2 text-xs tabular-nums">
					{done} / {files.length} files
				</p>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-lg">
			<h1 className="mb-6 text-xl font-semibold tracking-tight">New shoot</h1>

			<div className="card space-y-4">
				<div>
					<label className="field-label" htmlFor="shoot-name">
						Name
					</label>
					<input
						id="shoot-name"
						className="input"
						value={name}
						placeholder="Spring Concert"
						onChange={(e) => setName(e.target.value)}
					/>
				</div>

				<div>
					<label className="field-label" htmlFor="shoot-date">
						Date
					</label>
					<input
						id="shoot-date"
						type="date"
						className="input"
						value={date}
						onChange={(e) => setDate(e.target.value)}
					/>
				</div>

				<p className="text-ink-muted font-mono text-xs">{folderPreview}/</p>

				<div
					onDragOver={(e) => e.preventDefault()}
					onDrop={(e) => {
						e.preventDefault();
						addFiles(Array.from(e.dataTransfer.files));
					}}
					className="border-line-strong text-ink-muted rounded-md border-2 border-dashed px-4 py-8 text-center text-sm"
				>
					<p>Drop ARW files here</p>
					<label className="btn-ghost btn-sm mt-2 inline-block">
						Browse
						<input
							type="file"
							multiple
							accept=".arw,.ARW"
							hidden
							onChange={(e) => {
								addFiles(Array.from(e.target.files ?? []));
								e.target.value = '';
							}}
						/>
					</label>
					{files.length > 0 && (
						<p className="mt-3 text-xs">
							{files.length} file{files.length === 1 ? '' : 's'} · {formatBytes(totalBytes)}
							<button
								type="button"
								className="hover:text-ink ml-2 underline"
								onClick={() => setFiles([])}
							>
								clear
							</button>
						</p>
					)}
				</div>

				{error && <p className="text-bad text-xs">{error}</p>}

				<button type="button" className="btn-primary w-full" onClick={submit}>
					Create shoot{files.length > 0 ? ` and upload ${files.length}` : ''}
				</button>
			</div>
		</div>
	);
}
