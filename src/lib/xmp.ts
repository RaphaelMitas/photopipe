import 'server-only';
import { join, dirname, basename } from 'node:path';
import { stat } from 'node:fs/promises';
import { exiftool } from 'exiftool-vendored';
import type { PhysicalStage } from './config';
import { SELECT_LABEL, type StarRating } from './types';
import { stripExtension } from './utils';

/**
 * Metadata lives in the image files themselves so a shoot folder is
 * self-describing: xmp:Rating for stars, xmp:Label='Select' for curated picks.
 *
 * DNG and export formats take an embedded XMP packet. Proprietary raw (ARW) is
 * never modified — it gets an Adobe-style `.xmp` sidecar instead.
 */
export interface XmpMetadata {
	rating: StarRating | null;
	isSelect: boolean;
}

export const EMPTY_XMP: XmpMetadata = { rating: null, isSelect: false };

/** Dev-mode module reloads must not spawn a second exiftool process pool. */
const globalForExif = globalThis as unknown as { photopipeExiftool?: typeof exiftool };
const et = globalForExif.photopipeExiftool ?? exiftool;
if (process.env.NODE_ENV !== 'production') globalForExif.photopipeExiftool = et;

export function usesSidecar(stage: PhysicalStage): boolean {
	return stage === 'raw';
}

/** Adobe convention: DSC06568.ARW → DSC06568.xmp */
export function sidecarPathFor(imagePath: string): string {
	return join(dirname(imagePath), `${stripExtension(basename(imagePath))}.xmp`);
}

/** The file we actually read/write metadata on for a given image. */
export function metadataPathFor(stage: PhysicalStage, imagePath: string): string {
	return usesSidecar(stage) ? sidecarPathFor(imagePath) : imagePath;
}

function toRating(value: unknown): StarRating | null {
	const n = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(n)) return null;
	const rounded = Math.round(n);
	if (rounded < 1 || rounded > 5) return null;
	return rounded as StarRating;
}

/**
 * Reads rating/label for an image. For raw the sidecar wins; if there is no
 * sidecar we still check the raw file itself, since some cameras write a rating
 * in-camera.
 */
export async function readXmp(stage: PhysicalStage, imagePath: string): Promise<XmpMetadata> {
	const target = metadataPathFor(stage, imagePath);

	let readFrom = target;
	if (usesSidecar(stage)) {
		const sidecarExists = await stat(target).then(
			() => true,
			() => false
		);
		if (!sidecarExists) readFrom = imagePath;
	}

	try {
		const tags = await et.read(readFrom);
		return {
			rating: toRating(tags.Rating),
			isSelect: typeof tags.Label === 'string' && tags.Label.trim() === SELECT_LABEL
		};
	} catch (err) {
		console.warn(`XMP read failed for ${readFrom}:`, err instanceof Error ? err.message : err);
		return EMPTY_XMP;
	}
}

/**
 * Writes rating and/or select state. Only the provided fields are touched, so
 * rating a file never clobbers its label and vice versa.
 *
 * Returns the mtime of the metadata file afterwards, which the caller mirrors
 * into the index — that is what stops the watcher from re-reading its own write.
 */
export async function writeXmp(
	stage: PhysicalStage,
	imagePath: string,
	changes: { rating?: StarRating | null; isSelect?: boolean }
): Promise<{ metadataPath: string; mtimeMs: number }> {
	const target = metadataPathFor(stage, imagePath);

	const tags: Record<string, unknown> = {};
	if (changes.rating !== undefined) tags.Rating = changes.rating ?? null;
	if (changes.isSelect !== undefined) tags.Label = changes.isSelect ? SELECT_LABEL : null;

	if (Object.keys(tags).length > 0) {
		const result = await et.write(target, tags, { writeArgs: ['-overwrite_original'] });
		// DxO DNGs carry proprietary blocks exiftool cannot relocate; the write
		// still succeeds and the image survives intact, so warnings are logged only.
		if (result.warnings?.length) {
			for (const warning of result.warnings) {
				if (!warning.includes('hidden data')) console.warn(`exiftool: ${warning}`);
			}
		}
	}

	const info = await stat(target);
	return { metadataPath: target, mtimeMs: info.mtimeMs };
}

/**
 * Largest embedded JPEG for previewing a raw/DNG. DNGs carry PreviewImage;
 * Sony ARW keeps a full-size JpgFromRaw plus a small PreviewImage.
 */
const PREVIEW_TAGS = ['JpgFromRaw', 'PreviewImage', 'ThumbnailImage'] as const;

export async function extractEmbeddedPreview(imagePath: string): Promise<Buffer | null> {
	let best: Buffer | null = null;
	for (const tag of PREVIEW_TAGS) {
		try {
			const buf = await et.extractBinaryTagToBuffer(tag, imagePath);
			if (buf && (!best || buf.length > best.length)) best = buf;
			// A full-size JpgFromRaw beats anything else; stop early.
			if (tag === 'JpgFromRaw' && buf && buf.length > 500_000) return buf;
		} catch {
			// Tag absent for this file type — try the next one.
		}
	}
	return best;
}

/** EXIF orientation of the container, applied to extracted previews. */
export async function readOrientationAngle(imagePath: string): Promise<number> {
	try {
		const tags = await et.read(imagePath);
		const raw = tags.Orientation;
		const n = typeof raw === 'number' ? raw : Number(raw);
		switch (n) {
			case 6:
				return 90;
			case 3:
				return 180;
			case 8:
				return 270;
			default:
				return 0;
		}
	} catch {
		return 0;
	}
}

export async function endExiftool(): Promise<void> {
	await et.end();
}
