import { Readable } from 'node:stream';
import { ZipArchive } from 'archiver';
import { STAGE_DIRS, type PhysicalStage } from '@/lib/config';
import { PhotopipeError, handleRoute } from '@/lib/errors';
import { filePath } from '@/lib/paths';
import { filesForView, getShoot } from '@/lib/shoots';
import type { ViewStage } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ name: string }> };

const VIEWS: readonly ViewStage[] = ['raw', 'denoised', 'rated', 'selects', 'exports'];

/** Folder name each view gets inside the archive. */
const ARCHIVE_DIR: Record<ViewStage, string> = {
	raw: STAGE_DIRS.raw,
	denoised: STAGE_DIRS.denoised,
	exports: STAGE_DIRS.exports,
	rated: 'rated',
	selects: 'selects'
};

/**
 * `rated` and `selects` no longer exist on disk, so they are materialised here
 * from the index: the archive still contains the folders you expect.
 */
export async function GET(request: Request, { params }: Params) {
	return handleRoute(async () => {
		const { name } = await params;
		const folderName = decodeURIComponent(name);
		const url = new URL(request.url);

		const includeParam = url.searchParams.get('include');
		if (!includeParam) throw new PhotopipeError('Missing "include" parameter', 'INVALID_INPUT');

		const requested = includeParam
			.split(',')
			.map((s) => s.trim())
			.filter((s): s is ViewStage => VIEWS.includes(s as ViewStage));

		if (requested.length === 0) {
			throw new PhotopipeError('No valid folders specified', 'INVALID_INPUT');
		}

		const flat = url.searchParams.get('flat') === 'true';
		const minRatingParam = url.searchParams.get('minRating');
		const minRating = minRatingParam ? Number(minRatingParam) : null;
		if (minRating !== null && (!Number.isInteger(minRating) || minRating < 1 || minRating > 5)) {
			throw new PhotopipeError('minRating must be an integer 1-5', 'INVALID_INPUT');
		}

		const shoot = await getShoot(folderName);

		// Images are already compressed; storing beats spending CPU on deflate.
		const archive = new ZipArchive({ zlib: { level: 0 } });
		archive.on('warning', (err: unknown) => console.warn('archiver warning:', err));
		archive.on('error', (err: unknown) => console.error('archiver error:', err));

		let entryCount = 0;

		for (const view of requested) {
			let selection = filesForView(shoot.files, view);

			if (minRating !== null && (view === 'rated' || view === 'selects')) {
				selection = selection.filter((f) => f.rating !== null && f.rating >= minRating);
			}

			if (selection.length === 0) {
				if (!flat) archive.append('', { name: `${ARCHIVE_DIR[view]}/` });
				continue;
			}

			for (const file of selection) {
				const source = filePath(folderName, file.stage, file.name);
				archive.file(source, {
					name: flat ? file.name : `${ARCHIVE_DIR[view]}/${file.name}`
				});
				entryCount++;
			}
		}

		archive.finalize();

		if (entryCount === 0 && flat) {
			throw new PhotopipeError('Nothing to download for that selection', 'NOT_FOUND');
		}

		const webStream = Readable.toWeb(archive as unknown as Readable) as ReadableStream<Uint8Array>;

		return new Response(webStream, {
			headers: {
				'Content-Type': 'application/zip',
				'Content-Disposition': `attachment; filename="${folderName}.zip"`,
				'Cache-Control': 'no-store'
			}
		});
	});
}
