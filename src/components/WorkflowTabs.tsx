'use client';

import { VIEW_LABELS, VIEW_ORDER } from '@/lib/stages';
import type { StageCounts, ViewStage } from '@/lib/types';

export function WorkflowTabs({
	counts,
	current,
	onChange
}: {
	counts: StageCounts;
	current: ViewStage;
	onChange: (view: ViewStage) => void;
}) {
	return (
		<nav className="border-line mb-6 flex gap-1 border-b">
			{VIEW_ORDER.map((view) => {
				const count = counts[view];
				const active = view === current;
				return (
					<button
						key={view}
						type="button"
						onClick={() => onChange(view)}
						className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${
							active
								? 'border-accent text-ink'
								: 'text-ink-muted hover:text-ink-secondary border-transparent'
						}`}
					>
						{VIEW_LABELS[view]}
						<span
							className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
								count > 0 ? 'bg-active text-ink-secondary' : 'text-ink-muted'
							}`}
						>
							{count}
						</span>
					</button>
				);
			})}
		</nav>
	);
}
