import type { RequestHandler } from './$types.js';
import { error } from '@sveltejs/kit';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import archiver from 'archiver';
import { CAMERA_BASE, RAW_DIR, DENOISED_DIR, EXPORTS_DIR } from '$lib/server/config.js';
import { validateShootName } from '$lib/server/shoots.js';

const VALID_FOLDERS: Record<string, string> = {
	raw: RAW_DIR,
	denoised: DENOISED_DIR,
	exports: EXPORTS_DIR
};

export const GET: RequestHandler = async ({ params, url }) => {
	const shootName = decodeURIComponent(params.name);

	try {
		validateShootName(shootName);
	} catch {
		error(400, 'Invalid shoot name');
	}

	const shootPath = join(CAMERA_BASE, shootName);
	try {
		await stat(shootPath);
	} catch {
		error(404, 'Shoot not found');
	}

	// Parse include param
	const includeParam = url.searchParams.get('include');
	if (!includeParam) {
		error(400, 'Missing "include" parameter');
	}

	const requested = includeParam.split(',').filter((f) => f in VALID_FOLDERS);
	if (requested.length === 0) {
		error(400, 'No valid folders specified');
	}

	const flat = url.searchParams.get('flat') === 'true';

	// Create archiver stream — store mode (level 0), no compression for already-compressed images
	const archive = archiver('zip', { zlib: { level: 0 } });

	// Collect files for each requested folder
	for (const folderKey of requested) {
		const dirName = VALID_FOLDERS[folderKey];
		const dirPath = join(shootPath, dirName);

		let entries: string[] = [];
		try {
			entries = await readdir(dirPath);
			// Filter out hidden files
			entries = entries.filter((f) => !f.startsWith('.'));
		} catch {
			// Directory might not exist
		}

		if (entries.length === 0) {
			// Add empty directory entry when preserving structure
			if (!flat) {
				archive.append('', { name: `${dirName}/` });
			}
			continue;
		}

		for (const fileName of entries) {
			const filePath = join(dirPath, fileName);
			try {
				const info = await stat(filePath);
				if (!info.isFile()) continue;

				const archivePath = flat ? fileName : `${dirName}/${fileName}`;
				archive.file(filePath, { name: archivePath });
			} catch {
				// Skip files we can't stat
			}
		}
	}

	// Finalize the archive (signals no more files will be added)
	archive.finalize();

	// Convert Node.js Readable to web ReadableStream
	const nodeStream = archive as unknown as Readable;
	const webStream = new ReadableStream({
		start(controller) {
			nodeStream.on('data', (chunk: Buffer) => {
				controller.enqueue(new Uint8Array(chunk));
			});
			nodeStream.on('end', () => {
				controller.close();
			});
			nodeStream.on('error', (err) => {
				controller.error(err);
			});
		},
		cancel() {
			nodeStream.destroy();
		}
	});

	return new Response(webStream, {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${shootName}.zip"`,
			'Cache-Control': 'no-cache'
		}
	});
};
