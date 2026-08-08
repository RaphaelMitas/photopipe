import { Star } from "lucide-react";

type Props = {
  value: number;
  /// When set, stars are clickable and report the clicked star (clicking the
  /// current value clears to 0 — toggle semantics).
  onRate?: (rating: number) => void;
  className?: string;
};

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <Star
      className={`size-[1.2em] ${
        filled ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"
      }`}
    />
  );
}

export function Stars({ value, onRate, className }: Props) {
  const stars = [1, 2, 3, 4, 5].map((star) =>
    onRate ? (
      <button
        key={star}
        type="button"
        data-testid={`star-${star}`}
        onClick={() => onRate(star === value ? 0 : star)}
        className="transition-transform hover:scale-110"
      >
        <StarIcon filled={star <= value} />
      </button>
    ) : (
      <span key={star}>
        <StarIcon filled={star <= value} />
      </span>
    ),
  );
  return (
    <span
      className={`inline-flex items-center gap-0.5 ${className ?? ""}`}
      data-rating={value}
    >
      {stars}
    </span>
  );
}
