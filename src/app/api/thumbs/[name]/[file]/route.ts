import type { PhysicalStage } from '@/lib/config';
import { PhotopipeError, handleRoute } from '@/lib/errors';
import { getThumb, type ThumbSize } from '@/lib/thumbs';

export const runtime = 'nodejs';

type Params = { params: Promise<{ name: string; file: string }> };

const STAGES: readonly PhysicalStage[] = ['raw', 'denoised', 'exports'];

export async function GET(request: Request, { params }: Params) {
	return handleRoute(async () => {
		const { name, file } = await params;
		const url = new URL(request.url);

		const stage = (url.searchParams.get('stage') ?? 'denoised') as PhysicalStage;
		if (!STAGES.includes(stage)) {
			throw new PhotopipeError('Invalid stage parameter', 'INVALID_INPUT');
		}

		const size = (url.searchParams.get('size') ?? 'thumb') as ThumbSize;
		if (size !== 'thumb' && size !== 'preview') {
			throw new PhotopipeError('size must be "thumb" or "preview"', 'INVALID_INPUT');
		}

		const { data } = await getThumb(
			decodeURIComponent(name),
			stage,
			decodeURIComponent(file),
			size
		);

		return new Response(new Uint8Array(data), {
			headers: {
				'Content-Type': 'image/webp',
				'Content-Length': String(data.byteLength),
				'Cache-Control': 'public, max-age=86400'
			}
		});
	});
}
