import { z } from 'zod';
import { deleteFiles } from '@/lib/shoots';
import { handleRoute } from '@/lib/errors';

export const runtime = 'nodejs';

type Params = { params: Promise<{ name: string }> };

const bodySchema = z.object({
	stage: z.enum(['raw', 'denoised', 'exports']),
	files: z.array(z.string().min(1)).optional()
});

export async function DELETE(request: Request, { params }: Params) {
	return handleRoute(async () => {
		const { name } = await params;
		const parsed = bodySchema.safeParse(await request.json().catch(() => null));
		if (!parsed.success) {
			return Response.json({ error: 'stage must be raw, denoised or exports' }, { status: 400 });
		}

		const result = await deleteFiles(
			decodeURIComponent(name),
			parsed.data.stage,
			parsed.data.files
		);
		return Response.json(result);
	});
}
