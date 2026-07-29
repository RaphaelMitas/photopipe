import type { ShootStatus } from '@/lib/types';

const STYLES: Record<ShootStatus, string> = {
	empty: 'border-line text-ink-muted',
	uploading: 'border-accent/30 bg-accent/10 text-accent-light',
	denoising: 'border-warn/30 bg-warn/10 text-warn',
	ready: 'border-good/30 bg-good/10 text-good',
	rating: 'border-star/30 bg-star/10 text-star',
	curating: 'border-pick/30 bg-pick/10 text-pick',
	exported: 'border-good/30 bg-good/10 text-good'
};

export function StatusBadge({ status }: { status: ShootStatus }) {
	return (
		<span
			className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STYLES[status]}`}
		>
			{status}
		</span>
	);
}
