import { z } from 'zod';
import { deleteShoot, getShoot, updateShootMeta } from '@/lib/shoots';
import { handleRoute } from '@/lib/errors';

export const runtime = 'nodejs';

type Params = { params: Promise<{ name: string }> };

const patchSchema = z.object({
	algorithm: z.union([z.literal('DeepPRIME 3'), z.literal('DeepPRIME XD3'), z.null()]).optional(),
	notes: z.string().optional(),
	rawCount: z.number().int().nonnegative().nullable().optional()
});

export async function GET(_request: Request, { params }: Params) {
	return handleRoute(async () => {
		const { name } = await params;
		return Response.json(await getShoot(decodeURIComponent(name)));
	});
}

export async function PATCH(request: Request, { params }: Params) {
	return handleRoute(async () => {
		const { name } = await params;
		const parsed = patchSchema.safeParse(await request.json().catch(() => null));
		if (!parsed.success) return Response.json({ error: 'Invalid body' }, { status: 400 });

		await updateShootMeta(decodeURIComponent(name), parsed.data);
		return Response.json({ ok: true });
	});
}

export async function DELETE(_request: Request, { params }: Params) {
	return handleRoute(async () => {
		const { name } = await params;
		await deleteShoot(decodeURIComponent(name));
		return Response.json({ ok: true });
	});
}
