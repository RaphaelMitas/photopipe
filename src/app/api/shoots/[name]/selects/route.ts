import { z } from 'zod';
import { promoteByRating, setSelects } from '@/lib/shoots';
import { handleRoute } from '@/lib/errors';

export const runtime = 'nodejs';

type Params = { params: Promise<{ name: string }> };

const bodySchema = z
	.object({
		files: z.array(z.string().min(1)).min(1).optional(),
		isSelect: z.boolean().default(true),
		minRating: z.number().int().min(1).max(5).optional()
	})
	.refine((d) => d.files || d.minRating, { message: 'Provide files or minRating' });

/** Selects are an xmp:Label on the file — promoting nothing moves on disk. */
export async function POST(request: Request, { params }: Params) {
	return handleRoute(async () => {
		const { name } = await params;
		const folderName = decodeURIComponent(name);
		const parsed = bodySchema.safeParse(await request.json().catch(() => null));
		if (!parsed.success) {
			return Response.json(
				{ error: parsed.error.issues[0]?.message ?? 'Invalid body' },
				{ status: 400 }
			);
		}

		const applied = parsed.data.files
			? await setSelects(folderName, parsed.data.files, parsed.data.isSelect)
			: await promoteByRating(folderName, parsed.data.minRating!);

		return Response.json({ applied });
	});
}
