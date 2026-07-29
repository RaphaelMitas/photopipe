import { createWriteStream } from 'node:fs';
import { rename, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { STAGE_EXTENSIONS, type PhysicalStage } from '@/lib/config';
import { PhotopipeError, handleRoute } from '@/lib/errors';
import { assertShootName, stagePath } from '@/lib/paths';
import { finalizeUpload } from '@/lib/shoots';
import { markShootDirty } from '@/lib/sync/engine';
import { fileExtension } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ name: string }> };

const STAGES: readonly PhysicalStage[] = ['raw', 'denoised', 'exports'];

function sanitize(fileName: string): string {
	const cleaned = fileName.replace(/[/\\:*?"<>|]/g, '_').trim();
	if (!cleaned || cleaned.startsWith('.') || cleaned.includes('..')) {
		throw new PhotopipeError('Invalid filename', 'INVALID_INPUT');
	}
	return cleaned;
}

/**
 * Raw binary upload: the file is the request body, its name and stage ride in
 * the query string. This streams straight to disk instead of buffering a 50 MB
 * raw in memory the way multipart parsing would.
 */
export async function POST(request: Request, { params }: Params) {
	return handleRoute(async () => {
		const { name } = await params;
		const folderName = decodeURIComponent(name);
		assertShootName(folderName);

		const url = new URL(request.url);
		const stageParam = (url.searchParams.get('stage') ?? 'raw') as PhysicalStage;
		if (!STAGES.includes(stageParam)) {
			throw new PhotopipeError(`Invalid stage: ${stageParam}`, 'INVALID_INPUT');
		}

		const rawName = url.searchParams.get('file');
		if (!rawName) throw new PhotopipeError('Missing "file" parameter', 'INVALID_INPUT');
		const fileName = sanitize(decodeURIComponent(rawName));

		const allowed = STAGE_EXTENSIONS[stageParam];
		const ext = fileExtension(fileName);
		if (!allowed.includes(ext)) {
			throw new PhotopipeError(
				`${ext || 'This file type'} is not accepted in ${stageParam}/. Allowed: ${allowed.join(', ')}`,
				'INVALID_INPUT'
			);
		}

		if (!request.body) throw new PhotopipeError('Empty request body', 'INVALID_INPUT');

		const dir = stagePath(folderName, stageParam);
		await mkdir(dir, { recursive: true });

		// Hidden while incomplete: the reconciler skips dotfiles, so a partial
		// upload can never be indexed or shown.
		const finalPath = join(dir, fileName);
		const partPath = join(dir, `.${fileName}.part`);

		try {
			await pipeline(
				Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]),
				createWriteStream(partPath)
			);
			await rename(partPath, finalPath);
		} catch (err) {
			await unlink(partPath).catch(() => {});
			throw err;
		}

		markShootDirty(folderName, stageParam);
		return Response.json({ file: fileName, stage: stageParam });
	});
}

/** Called once an upload batch finishes: records how many raws to expect. */
export async function PATCH(_request: Request, { params }: Params) {
	return handleRoute(async () => {
		const { name } = await params;
		const rawCount = await finalizeUpload(decodeURIComponent(name));
		return Response.json({ rawCount });
	});
}
