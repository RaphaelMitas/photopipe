'use client';

import { useState } from 'react';
import type { StarRating as Stars } from '@/lib/types';

const SIZES = {
	sm: 'h-3 w-3',
	md: 'h-4 w-4',
	lg: 'h-6 w-6'
} as const;

const STARS: Stars[] = [1, 2, 3, 4, 5];

export function StarRating({
	value,
	onChange,
	size = 'md',
	readOnly = false
}: {
	value: Stars | null;
	onChange?: (rating: Stars | null) => void;
	size?: keyof typeof SIZES;
	readOnly?: boolean;
}) {
	const [hover, setHover] = useState<number | null>(null);
	const shown = hover ?? value ?? 0;

	return (
		<div
			className="inline-flex items-center gap-0.5"
			onMouseLeave={() => setHover(null)}
			role="group"
			aria-label={value ? `Rated ${value} of 5` : 'Unrated'}
		>
			{STARS.map((star) => (
				<button
					key={star}
					type="button"
					disabled={readOnly}
					aria-label={`${star} star${star > 1 ? 's' : ''}`}
					onMouseEnter={() => !readOnly && setHover(star)}
					onClick={(e) => {
						e.stopPropagation();
						// Clicking the current rating clears it, which is how you undo a misfire.
						onChange?.(value === star ? null : star);
					}}
					className={`transition-transform ${readOnly ? '' : 'hover:scale-110'}`}
				>
					<svg
						viewBox="0 0 24 24"
						className={`${SIZES[size]} ${star <= shown ? 'fill-star text-star' : 'text-ink-muted fill-transparent'}`}
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinejoin="round"
					>
						<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
					</svg>
				</button>
			))}
		</div>
	);
}
