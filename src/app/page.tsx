import Link from 'next/link';
import { listShoots } from '@/lib/shoots';
import { formatBytes, formatDate } from '@/lib/utils';
import { StatusBadge } from '@/components/StatusBadge';

export const dynamic = 'force-dynamic';

export default function DashboardPage() {
	const shoots = listShoots();

	if (shoots.length === 0) {
		return (
			<div className="border-line rounded-lg border border-dashed py-20 text-center">
				<p className="text-ink-secondary">No shoots yet.</p>
				<Link href="/new" className="btn-primary btn-sm mt-4">
					Create your first shoot
				</Link>
			</div>
		);
	}

	return (
		<div className="space-y-2">
			<div className="mb-6 flex items-baseline justify-between">
				<h1 className="text-xl font-semibold tracking-tight">Shoots</h1>
				<span className="text-ink-muted text-xs">{shoots.length} total</span>
			</div>

			{shoots.map((shoot) => (
				<Link
					key={shoot.folderName}
					href={`/shoot/${encodeURIComponent(shoot.folderName)}`}
					className="border-line bg-surface hover:border-line-strong block rounded-lg border p-4 transition-colors"
				>
					<div className="flex items-start justify-between gap-4">
						<div className="min-w-0">
							<h2 className="truncate font-medium">{shoot.name}</h2>
							<p className="text-ink-muted mt-0.5 text-xs">{formatDate(shoot.date)}</p>
						</div>
						<StatusBadge status={shoot.status} />
					</div>

					<div className="text-ink-muted mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
						<span>{shoot.counts.raw} raw</span>
						<span>{shoot.counts.denoised} dng</span>
						<span>{shoot.counts.rated} rated</span>
						<span className="text-pick/80">{shoot.counts.selects} selects</span>
						<span>{shoot.counts.exports} exports</span>
						<span className="ml-auto tabular-nums">{formatBytes(shoot.totalSizeBytes)}</span>
					</div>
				</Link>
			))}
		</div>
	);
}
