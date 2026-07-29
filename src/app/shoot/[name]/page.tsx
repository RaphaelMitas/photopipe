import { notFound } from 'next/navigation';
import { getShoot, getPureRawInstructions } from '@/lib/shoots';
import { PhotopipeError } from '@/lib/errors';
import { ShootWorkspace } from '@/components/ShootWorkspace';

export const dynamic = 'force-dynamic';

export default async function ShootPage({ params }: { params: Promise<{ name: string }> }) {
	const { name } = await params;
	const folderName = decodeURIComponent(name);

	const shoot = await getShoot(folderName).catch((err: unknown) => {
		if (err instanceof PhotopipeError && err.code === 'NOT_FOUND') notFound();
		throw err;
	});

	return <ShootWorkspace shoot={shoot} instructions={getPureRawInstructions(folderName)} />;
}
