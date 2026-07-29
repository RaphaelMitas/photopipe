import { z } from 'zod';
import { createShoot } from '@/lib/shoots';
import { handleRoute } from '@/lib/errors';

export const runtime = 'nodejs';

const bodySchema = z.object({
	name: z.string().trim().min(1),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
});

export async function POST(request: Request) {
	return handleRoute(async () => {
		const parsed = bodySchema.safeParse(await request.json().catch(() => null));
		if (!parsed.success) {
			return Response.json(
				{ error: parsed.error.issues[0]?.message ?? 'Invalid body' },
				{ status: 400 }
			);
		}

		const folderName = await createShoot(parsed.data.name, parsed.data.date);
		return Response.json({ folderName }, { status: 201 });
	});
}
