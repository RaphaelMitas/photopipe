'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExposureCanvas } from './ExposureCanvas';
import { StarRating } from './StarRating';
import { thumbUrl } from '@/lib/api';
import { DEFAULT_ADJUSTMENTS, hasAdjustments } from '@/lib/webgl/exposure-renderer';
import type { AdjustmentParams } from '@/lib/webgl/exposure-renderer';
import type { FileInfo, PhysicalStage, StarRating as Stars } from '@/lib/types';

type FilterMode = 'all' | 'unrated' | 'eq' | 'gte' | 'lte';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const FLUSH_DELAY_MS = 500;

export function RatingView({
	folderName,
	files,
	stage,
	startIndex,
	onClose,
	onSave,
	onToggleSelect
}: {
	folderName: string;
	files: FileInfo[];
	stage: PhysicalStage;
	startIndex: number;
	onClose: () => void;
	onSave: (ratings: Array<{ file: string; rating: Stars | null }>) => Promise<unknown>;
	onToggleSelect: (fileName: string, isSelect: boolean) => void;
}) {
	const [index, setIndex] = useState(startIndex);
	const [zoomed, setZoomed] = useState(false);
	const [adjustments, setAdjustments] = useState<AdjustmentParams>({ ...DEFAULT_ADJUSTMENTS });
	const [filterMode, setFilterMode] = useState<FilterMode>('all');
	const [filterValue, setFilterValue] = useState(4);
	const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
	const [retryToken, setRetryToken] = useState(0);

	/** Ratings typed but not yet confirmed by the server; they win over server state. */
	const [localRatings, setLocalRatings] = useState<Map<string, Stars | null>>(new Map());
	const pendingRef = useRef<Map<string, Stars | null>>(new Map());
	const flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const filmstripRef = useRef<HTMLDivElement>(null);
	const previewRef = useRef<HTMLDivElement>(null);

	const current = files[index];

	const ratingOf = useCallback(
		(file: FileInfo): Stars | null =>
			localRatings.has(file.name) ? (localRatings.get(file.name) ?? null) : file.rating,
		[localRatings]
	);

	const matchesFilter = useCallback(
		(file: FileInfo): boolean => {
			if (filterMode === 'all') return true;
			const rating = ratingOf(file);
			if (filterMode === 'unrated') return rating === null;
			if (rating === null) return false;
			if (filterMode === 'eq') return rating === filterValue;
			if (filterMode === 'gte') return rating >= filterValue;
			return rating <= filterValue;
		},
		[filterMode, filterValue, ratingOf]
	);

	const filteredIndices = useMemo(
		() => files.map((_, i) => i).filter((i) => matchesFilter(files[i]!)),
		[files, matchesFilter]
	);

	const ratedCount = useMemo(
		() => files.filter((f) => ratingOf(f) !== null).length,
		[files, ratingOf]
	);

	const flush = useCallback(async () => {
		clearTimeout(flushTimer.current);
		const batch = Array.from(pendingRef.current.entries()).map(([file, rating]) => ({
			file,
			rating
		}));
		if (batch.length === 0) return;
		pendingRef.current = new Map();

		setSaveStatus('saving');
		try {
			await onSave(batch);
			setSaveStatus('saved');
			// The server now agrees, so stop overriding these locally.
			setLocalRatings((prev) => {
				const next = new Map(prev);
				for (const { file } of batch) {
					if (!pendingRef.current.has(file)) next.delete(file);
				}
				return next;
			});
			clearTimeout(savedTimer.current);
			savedTimer.current = setTimeout(() => setSaveStatus('idle'), 2000);
		} catch {
			setSaveStatus('error');
			for (const { file, rating } of batch) pendingRef.current.set(file, rating);
			setRetryToken((t) => t + 1);
		}
	}, [onSave]);

	// A failed save leaves the ratings queued; retry on a timer until it lands.
	useEffect(() => {
		if (saveStatus !== 'error') return;
		const timer = setTimeout(() => void flush(), FLUSH_DELAY_MS * 4);
		return () => clearTimeout(timer);
	}, [saveStatus, retryToken, flush]);

	const setRating = useCallback(
		(rating: Stars | null) => {
			if (!current) return;
			setLocalRatings((prev) => new Map(prev).set(current.name, rating));
			pendingRef.current.set(current.name, rating);
			clearTimeout(flushTimer.current);
			flushTimer.current = setTimeout(flush, FLUSH_DELAY_MS);
		},
		[current, flush]
	);

	const goTo = useCallback(
		(next: number) => {
			setIndex(Math.max(0, Math.min(next, files.length - 1)));
			setZoomed(false);
		},
		[files.length]
	);

	const goPrev = useCallback(() => {
		if (filterMode === 'all') return goTo(index - 1);
		const prev = filteredIndices.filter((i) => i < index);
		if (prev.length > 0) goTo(prev[prev.length - 1]!);
	}, [filterMode, filteredIndices, goTo, index]);

	const goNext = useCallback(() => {
		if (filterMode === 'all') return goTo(index + 1);
		const next = filteredIndices.find((i) => i > index);
		if (next !== undefined) goTo(next);
	}, [filterMode, filteredIndices, goTo, index]);

	const close = useCallback(async () => {
		await flush();
		onClose();
	}, [flush, onClose]);

	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

			switch (e.key) {
				case 'Escape':
					if (zoomed) return setZoomed(false);
					void close();
					return;
				case 'z':
				case ' ':
					e.preventDefault();
					setZoomed((z) => !z);
					return;
				case 'ArrowLeft':
					e.preventDefault();
					return goPrev();
				case 'ArrowRight':
					e.preventDefault();
					return goNext();
				case 'ArrowUp':
					e.preventDefault();
					return setAdjustments((a) => ({
						...a,
						exposure: Math.min(5, +(a.exposure + 0.25).toFixed(2))
					}));
				case 'ArrowDown':
					e.preventDefault();
					return setAdjustments((a) => ({
						...a,
						exposure: Math.max(-5, +(a.exposure - 0.25).toFixed(2))
					}));
				case 'b':
					e.preventDefault();
					return setAdjustments({ ...DEFAULT_ADJUSTMENTS });
				case 'p':
					e.preventDefault();
					if (current) onToggleSelect(current.name, !current.isSelect);
					return;
				case '0':
					e.preventDefault();
					return setRating(null);
			}

			const num = Number(e.key);
			if (Number.isInteger(num) && num >= 1 && num <= 5) {
				e.preventDefault();
				setRating(num as Stars);
			}
		}

		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [close, current, goNext, goPrev, onToggleSelect, setRating, zoomed]);

	useEffect(() => {
		const strip = filmstripRef.current;
		strip?.children[index]?.scrollIntoView({
			behavior: 'smooth',
			block: 'nearest',
			inline: 'center'
		});
	}, [index]);

	useEffect(
		() => () => {
			clearTimeout(flushTimer.current);
			clearTimeout(savedTimer.current);
		},
		[]
	);

	function toggleZoom(e: React.MouseEvent<HTMLDivElement>) {
		const area = previewRef.current;
		if (!zoomed && area) {
			const rect = area.getBoundingClientRect();
			const x = (e.clientX - rect.left) / rect.width;
			const y = (e.clientY - rect.top) / rect.height;
			setZoomed(true);
			requestAnimationFrame(() => {
				area.scrollLeft = (area.scrollWidth - rect.width) * x;
				area.scrollTop = (area.scrollHeight - rect.height) * y;
			});
		} else {
			setZoomed(false);
		}
	}

	const filteredPos = filteredIndices.indexOf(index);
	const adjusted = hasAdjustments(adjustments);

	return (
		<div className="bg-root fixed inset-0 z-50 flex flex-col">
			<header className="border-line flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2">
				<button type="button" className="btn-ghost btn-sm" onClick={() => void close()}>
					Close
				</button>

				<div className="flex flex-col items-center gap-1">
					<div className="bg-active flex gap-0.5 rounded-md p-0.5">
						<FilterButton active={filterMode === 'all'} onClick={() => setFilterMode('all')}>
							All
						</FilterButton>
						<select
							value={filterMode === 'all' || filterMode === 'unrated' ? 'gte' : filterMode}
							onChange={(e) => setFilterMode(e.target.value as FilterMode)}
							className="bg-surface text-accent-light rounded px-1 text-xs font-semibold"
							aria-label="Rating comparison"
						>
							<option value="gte">≥</option>
							<option value="eq">=</option>
							<option value="lte">≤</option>
						</select>
						{[1, 2, 3, 4, 5].map((star) => (
							<FilterButton
								key={star}
								active={filterMode !== 'all' && filterMode !== 'unrated' && filterValue === star}
								onClick={() => {
									setFilterMode((m) => (m === 'all' || m === 'unrated' ? 'gte' : m));
									setFilterValue(star);
								}}
							>
								{star}★
							</FilterButton>
						))}
						<FilterButton
							active={filterMode === 'unrated'}
							onClick={() => setFilterMode('unrated')}
						>
							Unrated
						</FilterButton>
					</div>
					<span className="text-ink-muted text-[11px]">
						{filterMode !== 'all' && (
							<>
								{filteredPos >= 0 ? filteredPos + 1 : '–'} / {filteredIndices.length} filtered
								·{' '}
							</>
						)}
						{ratedCount} of {files.length} rated
					</span>
				</div>

				<span
					className={`min-w-24 text-right text-xs ${
						saveStatus === 'error'
							? 'text-bad'
							: saveStatus === 'saved'
								? 'text-good'
								: 'text-ink-muted'
					}`}
				>
					{saveStatus === 'saving' && 'Saving…'}
					{saveStatus === 'saved' && 'Saved'}
					{saveStatus === 'error' && 'Save failed — retrying'}
				</span>
			</header>

			<div className="flex min-h-0 flex-1 items-center">
				<NavButton direction="prev" onClick={goPrev} disabled={index <= 0} />

				<div
					ref={previewRef}
					onClick={toggleZoom}
					role="button"
					tabIndex={-1}
					aria-label={zoomed ? 'Zoom out' : 'Zoom in'}
					className={`flex h-full flex-1 items-center justify-center p-4 ${
						zoomed ? 'cursor-zoom-out overflow-auto' : 'cursor-zoom-in overflow-hidden'
					}`}
				>
					{current && (
						<ExposureCanvas
							key={current.name}
							src={thumbUrl(folderName, stage, current.name, 'preview')}
							alt={current.name}
							adjustments={adjustments}
							className={zoomed ? 'max-w-none' : 'max-h-full max-w-full object-contain'}
						/>
					)}
				</div>

				<NavButton direction="next" onClick={goNext} disabled={index >= files.length - 1} />
			</div>

			<div className="border-line shrink-0 border-t">
				<div className="flex flex-wrap items-center justify-center gap-4 px-4 py-2">
					<span className="text-ink-muted max-w-64 truncate font-mono text-xs">
						{current?.name}
					</span>

					<StarRating value={current ? ratingOf(current) : null} size="lg" onChange={setRating} />

					<button
						type="button"
						onClick={() => current && onToggleSelect(current.name, !current.isSelect)}
						className={`btn btn-sm ${
							current?.isSelect
								? 'border-pick/40 bg-pick/15 text-pick'
								: 'border-line bg-surface text-ink-secondary hover:text-ink'
						}`}
					>
						{current?.isSelect ? '★ Select' : 'Mark select'}
					</button>

					<div className="flex items-center gap-2">
						<label htmlFor="exposure" className="text-ink-muted text-xs">
							EV
						</label>
						<input
							id="exposure"
							type="range"
							min={-5}
							max={5}
							step={0.05}
							value={adjustments.exposure}
							onChange={(e) => setAdjustments((a) => ({ ...a, exposure: Number(e.target.value) }))}
							className="w-32"
						/>
						<button
							type="button"
							onClick={() => setAdjustments({ ...DEFAULT_ADJUSTMENTS })}
							className={`w-16 text-left font-mono text-xs ${adjusted ? 'text-accent-light' : 'text-ink-muted'}`}
							title="Reset exposure (b)"
						>
							{adjustments.exposure >= 0 ? '+' : ''}
							{adjustments.exposure.toFixed(2)}
						</button>
					</div>

					<span className="text-ink-muted hidden text-[11px] lg:block">
						1–5 rate · 0 clear · p select · ←→ navigate · ↑↓ exposure · b reset · z zoom
					</span>
				</div>

				<div ref={filmstripRef} className="flex gap-1 overflow-x-auto px-3 pb-3">
					{files.map((file, i) => {
						const rating = ratingOf(file);
						return (
							<button
								key={file.name}
								type="button"
								onClick={() => goTo(i)}
								className={`relative h-16 w-16 shrink-0 overflow-hidden rounded border transition-opacity ${
									i === index ? 'border-accent' : 'border-line'
								} ${filterMode !== 'all' && !matchesFilter(file) ? 'opacity-25' : ''}`}
							>
								{/* eslint-disable-next-line @next/next/no-img-element */}
								<img
									src={thumbUrl(folderName, file.stage, file.name)}
									alt=""
									loading="lazy"
									draggable={false}
									className="h-full w-full object-cover"
								/>
								{rating !== null && (
									<span className="text-star absolute right-0.5 bottom-0.5 rounded bg-black/70 px-1 text-[10px]">
										{rating}
									</span>
								)}
								{file.isSelect && (
									<span className="bg-pick absolute top-0.5 left-0.5 h-1.5 w-1.5 rounded-full" />
								)}
							</button>
						);
					})}
				</div>
			</div>

			{/* Warm the neighbours so navigation feels instant. */}
			{[files[index - 1], files[index + 1]].map(
				(neighbour) =>
					neighbour && (
						<link
							key={neighbour.name}
							rel="prefetch"
							as="image"
							href={thumbUrl(folderName, neighbour.stage, neighbour.name, 'preview')}
						/>
					)
			)}
		</div>
	);
}

function FilterButton({
	active,
	onClick,
	children
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
				active ? 'bg-surface text-ink' : 'text-ink-muted hover:text-ink-secondary'
			}`}
		>
			{children}
		</button>
	);
}

function NavButton({
	direction,
	onClick,
	disabled
}: {
	direction: 'prev' | 'next';
	onClick: () => void;
	disabled: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-label={direction === 'prev' ? 'Previous image' : 'Next image'}
			className="text-ink-muted hover:text-ink h-full shrink-0 px-3 transition-colors disabled:opacity-20"
		>
			<svg
				viewBox="0 0 24 24"
				className="h-6 w-6"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
			>
				<polyline points={direction === 'prev' ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
			</svg>
		</button>
	);
}
