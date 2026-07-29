'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from './ConfirmDialog';
import { DenoiseProgress } from './DenoiseProgress';
import { DownloadDialog } from './DownloadDialog';
import { Gallery } from './Gallery';
import { RatingView } from './RatingView';
import { SettingsDialog } from './SettingsDialog';
import { StatusBadge } from './StatusBadge';
import { UploadPanel } from './UploadPanel';
import { WorkflowTabs } from './WorkflowTabs';
import {
	deleteShoot,
	useDeleteFilesMutation,
	useRateMutation,
	useSelectMutation,
	useShoot
} from '@/lib/api';
import { VIEW_SOURCE_STAGE } from '@/lib/stages';
import { formatBytes, formatDate } from '@/lib/utils';
import { PURERAW_SETTINGS } from '@/lib/types';
import type {
	FileInfo,
	PhysicalStage,
	PureRawInstructions,
	ShootDetail,
	StarRating as Stars,
	ViewStage
} from '@/lib/types';

function initialView(status: ShootDetail['status']): ViewStage {
	switch (status) {
		case 'exported':
			return 'exports';
		case 'curating':
			return 'selects';
		case 'rating':
			return 'rated';
		case 'ready':
		case 'denoising':
			return 'denoised';
		default:
			return 'raw';
	}
}

export function ShootWorkspace({
	shoot: initial,
	instructions
}: {
	shoot: ShootDetail;
	instructions: PureRawInstructions;
}) {
	const router = useRouter();
	const { data: shoot = initial } = useShoot(initial.folderName, initial);

	const [view, setView] = useState<ViewStage>(() => initialView(initial.status));
	const [ratingViewAt, setRatingViewAt] = useState<number | null>(null);
	const [showDownload, setShowDownload] = useState(false);
	const [showSettings, setShowSettings] = useState(false);
	const [pendingDelete, setPendingDelete] = useState<{
		stage: PhysicalStage;
		files?: string[];
		label: string;
	} | null>(null);
	const [confirmShootDelete, setConfirmShootDelete] = useState(false);

	const rate = useRateMutation(shoot.folderName);
	const select = useSelectMutation(shoot.folderName);
	const removeFiles = useDeleteFilesMutation(shoot.folderName);

	const visible: FileInfo[] = useMemo(() => {
		switch (view) {
			case 'rated':
				return shoot.files.filter((f) => f.stage === 'denoised' && f.rating !== null);
			case 'selects':
				return shoot.files.filter((f) => f.stage === 'denoised' && f.isSelect);
			default:
				return shoot.files.filter((f) => f.stage === view);
		}
	}, [shoot.files, view]);

	/** The rating view always works over every denoised file, so you can rate past the filter. */
	const cullList = useMemo(
		() =>
			view === 'exports' || view === 'raw'
				? visible
				: shoot.files.filter((f) => f.stage === 'denoised'),
		[shoot.files, view, visible]
	);

	const sourceStage = VIEW_SOURCE_STAGE[view];
	const unratedCount = shoot.counts.denoised - shoot.counts.rated;
	const readyToPromote = shoot.files.filter(
		(f) => f.stage === 'denoised' && (f.rating ?? 0) >= 4 && !f.isSelect
	).length;

	function openCull(fileName: string) {
		const index = cullList.findIndex((f) => f.name === fileName);
		setRatingViewAt(Math.max(0, index));
	}

	return (
		<div className="animate-view">
			<Link
				href="/"
				className="text-ink-muted hover:text-ink mb-6 inline-flex items-center gap-1 text-xs"
			>
				← Back
			</Link>

			<header className="mb-5 flex items-start justify-between gap-4">
				<div className="min-w-0">
					<h1 className="truncate text-xl font-semibold tracking-tight">{shoot.name}</h1>
					<p className="text-ink-muted mt-0.5 text-xs">
						{formatDate(shoot.date)} · <span className="font-mono">{shoot.folderName}</span>
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<button type="button" className="btn-ghost btn-sm" onClick={() => setShowSettings(true)}>
						Settings
					</button>
					<button type="button" className="btn-ghost btn-sm" onClick={() => setShowDownload(true)}>
						Download
					</button>
					<StatusBadge status={shoot.status} />
				</div>
			</header>

			<WorkflowTabs counts={shoot.counts} current={view} onChange={setView} />

			{view === 'raw' && (
				<div className="space-y-6">
					<Section title="Upload">
						<UploadPanel folderName={shoot.folderName} stage="raw" allowStageChange />
					</Section>

					{visible.length > 0 && (
						<Section
							title="Raw files"
							meta={`${shoot.counts.raw} · ${formatBytes(shoot.sizes.raw)}`}
							action={
								<button
									type="button"
									className="btn-danger btn-sm"
									onClick={() =>
										setPendingDelete({
											stage: 'raw',
											label: `all ${shoot.counts.raw} ARW files (${formatBytes(shoot.sizes.raw)})`
										})
									}
								>
									Delete all
								</button>
							}
						>
							<FileList
								files={visible}
								onDelete={(name) => setPendingDelete({ stage: 'raw', files: [name], label: name })}
							/>
							{shoot.counts.denoised > 0 && (
								<p className="text-ink-muted mt-3 text-xs">
									{shoot.counts.raw} ARWs → {shoot.counts.denoised} DNGs
									{shoot.counts.raw === shoot.counts.denoised ? (
										<span className="text-good ml-1">✓ match</span>
									) : (
										<span className="text-warn ml-1">mismatch</span>
									)}
								</p>
							)}
						</Section>
					)}
				</div>
			)}

			{view === 'denoised' && (
				<div className="space-y-6">
					{shoot.counts.denoised > 0 && (
						<NextAction
							title="Start rating"
							detail={`${unratedCount} of ${shoot.counts.denoised} still unrated · 1–5 to rate, arrows to move`}
							onClick={() => {
								setView('rated');
								setRatingViewAt(0);
							}}
						/>
					)}

					<Section title="Denoise progress">
						<DenoiseProgress
							current={shoot.counts.denoised}
							expected={shoot.manifest.rawCount ?? shoot.counts.raw}
							algorithm={shoot.manifest.algorithm}
						/>
					</Section>

					<Section title="PureRAW instructions">
						<div className="card space-y-3 text-sm">
							<div className="space-y-1 font-mono text-xs">
								<p>
									<span className="text-ink-muted mr-2">in </span>
									{instructions.inputPath}
								</p>
								<p>
									<span className="text-ink-muted mr-2">out</span>
									{instructions.outputPath}
								</p>
							</div>
							<dl className="divide-border-subtle divide-y text-xs">
								{Object.entries(PURERAW_SETTINGS).map(([key, value]) => (
									<div key={key} className="flex justify-between py-1.5">
										<dt className="text-ink-muted">{key}</dt>
										<dd>{value}</dd>
									</div>
								))}
							</dl>
						</div>
					</Section>

					{visible.length > 0 && (
						<Section
							title="Denoised files"
							meta={`${shoot.counts.denoised} · ${formatBytes(shoot.sizes.denoised)}`}
							action={
								<button
									type="button"
									className="btn-danger btn-sm"
									onClick={() =>
										setPendingDelete({
											stage: 'denoised',
											label: `all ${shoot.counts.denoised} DNG files (${formatBytes(shoot.sizes.denoised)})`
										})
									}
								>
									Delete all
								</button>
							}
						>
							<Gallery
								folderName={shoot.folderName}
								files={visible}
								onOpen={openCull}
								onRate={(file, rating) => rate.mutate([{ file, rating }])}
								onToggleSelect={(file, isSelect) => select.mutate({ files: [file], isSelect })}
								onBulkSelect={(files, isSelect) => select.mutate({ files, isSelect })}
								onDelete={(name) =>
									setPendingDelete({ stage: 'denoised', files: [name], label: name })
								}
							/>
						</Section>
					)}
				</div>
			)}

			{view === 'rated' && (
				<div className="space-y-6">
					{shoot.counts.denoised > 0 && (
						<NextAction
							title="Open rating view"
							detail={`${shoot.counts.denoised} image${shoot.counts.denoised === 1 ? '' : 's'} · ${unratedCount} unrated`}
							onClick={() => setRatingViewAt(0)}
						/>
					)}

					{readyToPromote > 0 && (
						<NextAction
							tone="pick"
							title="Mark ≥4★ as selects"
							detail={`${readyToPromote} rated image${readyToPromote === 1 ? '' : 's'} qualify`}
							onClick={() => select.mutate({ minRating: 4 })}
						/>
					)}

					<Section title="Rated" meta={`${shoot.counts.rated} · ${formatBytes(shoot.sizes.rated)}`}>
						<Gallery
							folderName={shoot.folderName}
							files={visible}
							onOpen={openCull}
							onRate={(file, rating) => rate.mutate([{ file, rating }])}
							onToggleSelect={(file, isSelect) => select.mutate({ files: [file], isSelect })}
							onBulkSelect={(files, isSelect) => select.mutate({ files, isSelect })}
						/>
					</Section>
				</div>
			)}

			{view === 'selects' && (
				<div className="space-y-6">
					{readyToPromote > 0 && visible.length === 0 && (
						<NextAction
							tone="pick"
							title="Mark ≥4★ as selects"
							detail={`${readyToPromote} rated image${readyToPromote === 1 ? '' : 's'} qualify`}
							onClick={() => select.mutate({ minRating: 4 })}
						/>
					)}

					<Section
						title="Selects"
						meta={`${shoot.counts.selects} · ${formatBytes(shoot.sizes.selects)}`}
					>
						<Gallery
							folderName={shoot.folderName}
							files={visible}
							onOpen={openCull}
							onRate={(file, rating) => rate.mutate([{ file, rating }])}
							onToggleSelect={(file, isSelect) => select.mutate({ files: [file], isSelect })}
							onBulkSelect={(files, isSelect) => select.mutate({ files, isSelect })}
						/>
					</Section>
				</div>
			)}

			{view === 'exports' && (
				<div className="space-y-6">
					<Section
						title="Exports"
						meta={`${shoot.counts.exports} · ${formatBytes(shoot.sizes.exports)}`}
						action={
							shoot.counts.exports > 0 ? (
								<button
									type="button"
									className="btn-danger btn-sm"
									onClick={() =>
										setPendingDelete({
											stage: 'exports',
											label: `all ${shoot.counts.exports} exported files (${formatBytes(shoot.sizes.exports)})`
										})
									}
								>
									Delete all
								</button>
							) : undefined
						}
					>
						<Gallery
							folderName={shoot.folderName}
							files={visible}
							onOpen={openCull}
							onDelete={(name) =>
								setPendingDelete({ stage: 'exports', files: [name], label: name })
							}
						/>
					</Section>

					<Section title="Upload exports">
						<UploadPanel folderName={shoot.folderName} stage="exports" />
					</Section>
				</div>
			)}

			{ratingViewAt !== null && cullList.length > 0 && (
				<RatingView
					folderName={shoot.folderName}
					files={cullList}
					stage={sourceStage}
					startIndex={ratingViewAt}
					onClose={() => setRatingViewAt(null)}
					onSave={(ratings) => rate.mutateAsync(ratings)}
					onToggleSelect={(file, isSelect) => select.mutate({ files: [file], isSelect })}
				/>
			)}

			<DownloadDialog
				open={showDownload}
				folderName={shoot.folderName}
				counts={shoot.counts}
				sizes={shoot.sizes}
				onClose={() => setShowDownload(false)}
			/>

			<SettingsDialog
				open={showSettings}
				folderName={shoot.folderName}
				algorithm={shoot.manifest.algorithm}
				notes={shoot.manifest.notes}
				totalSizeBytes={shoot.totalSizeBytes}
				onClose={() => setShowSettings(false)}
				onSaved={() => router.refresh()}
				onDeleteShoot={() => {
					setShowSettings(false);
					setConfirmShootDelete(true);
				}}
			/>

			<ConfirmDialog
				open={pendingDelete !== null}
				title="Delete files?"
				message={`This permanently deletes ${pendingDelete?.label ?? ''}. This cannot be undone.`}
				confirmLabel="Delete"
				busy={removeFiles.isPending}
				onCancel={() => setPendingDelete(null)}
				onConfirm={() => {
					if (!pendingDelete) return;
					removeFiles.mutate(
						{ stage: pendingDelete.stage, files: pendingDelete.files },
						{ onSettled: () => setPendingDelete(null) }
					);
				}}
			/>

			<ConfirmDialog
				open={confirmShootDelete}
				title="Delete this shoot?"
				message={`This permanently deletes ${shoot.folderName} and everything in it (${formatBytes(shoot.totalSizeBytes)}). This cannot be undone.`}
				confirmLabel="Delete shoot"
				onCancel={() => setConfirmShootDelete(false)}
				onConfirm={async () => {
					await deleteShoot(shoot.folderName);
					router.push('/');
				}}
			/>
		</div>
	);
}

function Section({
	title,
	meta,
	action,
	children
}: {
	title: string;
	meta?: string;
	action?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<section>
			<div className="border-line mb-3 flex items-center justify-between gap-3 border-b pb-2">
				<h2 className="text-sm font-semibold">
					{title}
					{meta && <span className="text-ink-muted ml-2 font-normal">{meta}</span>}
				</h2>
				{action}
			</div>
			{children}
		</section>
	);
}

function NextAction({
	title,
	detail,
	onClick,
	tone = 'accent'
}: {
	title: string;
	detail: string;
	onClick: () => void;
	tone?: 'accent' | 'pick';
}) {
	const tones = {
		accent: 'border-accent/25 bg-accent/10 hover:border-accent/45',
		pick: 'border-pick/25 bg-pick/10 hover:border-pick/45'
	};

	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors ${tones[tone]}`}
		>
			<span>
				<span className="block text-sm font-semibold">{title}</span>
				<span className="text-ink-secondary mt-0.5 block text-xs">{detail}</span>
			</span>
			<span className="text-ink-muted">›</span>
		</button>
	);
}

function FileList({
	files,
	onDelete
}: {
	files: FileInfo[];
	onDelete: (fileName: string) => void;
}) {
	return (
		<div className="divide-border-subtle border-line bg-surface max-h-80 divide-y overflow-y-auto rounded-md border">
			{files.map((file) => (
				<div key={file.name} className="group flex items-center gap-2 px-3 py-1.5 text-xs">
					<span className="text-ink-secondary flex-1 truncate font-mono">{file.name}</span>
					<span className="text-ink-muted tabular-nums">{formatBytes(file.sizeBytes)}</span>
					<button
						type="button"
						onClick={() => onDelete(file.name)}
						className="text-ink-muted hover:text-bad opacity-0 transition-opacity group-hover:opacity-100"
						aria-label={`Delete ${file.name}`}
					>
						×
					</button>
				</div>
			))}
		</div>
	);
}

export type { Stars };
