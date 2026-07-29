import { z } from 'zod';
import { setRatings } from '@/lib/shoots';
import { handleRoute } from '@/lib/errors';

export const runtime = 'nodejs';

type Params = { params: Promise<{ name: string }> };

const stage = z.enum(['raw', 'denoised', 'exports']);

const bodySchema = z.object({
	stage: stage.default('denoised'),
	ratings: z
		.array(
			z.object({
				file: z.string().min(1),
				rating: z
					.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
					.nullable()
			})
		)
		.min(1)
});

/** Writes xmp:Rating into the files themselves; nothing moves on disk. */
export async function POST(request: Request, { params }: Params) {
	return handleRoute(async () => {
		const { name } = await params;
		const parsed = bodySchema.safeParse(await request.json().catch(() => null));
		if (!parsed.success) {
			return Response.json(
				{ error: 'ratings must be [{file, rating: 1-5|null}]' },
				{ status: 400 }
			);
		}

		const applied = await setRatings(
			decodeURIComponent(name),
			parsed.data.ratings,
			parsed.data.stage
		);
		return Response.json({ applied });
	});
}
