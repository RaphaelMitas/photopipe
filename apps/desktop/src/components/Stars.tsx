type Props = {
  value: number;
  /// When set, stars are clickable and report the clicked star (clicking the
  /// current value clears to 0 — toggle semantics).
  onRate?: (rating: number) => void;
  className?: string;
};

export function Stars({ value, onRate, className }: Props) {
  const stars = [1, 2, 3, 4, 5].map((star) =>
    onRate ? (
      <button
        key={star}
        type="button"
        data-testid={`star-${star}`}
        onClick={() => onRate(star === value ? 0 : star)}
        className={`transition-colors hover:text-amber-300 ${
          star <= value ? "text-amber-400" : "text-muted-foreground/40"
        }`}
      >
        ★
      </button>
    ) : (
      <span
        key={star}
        className={
          star <= value ? "text-amber-400" : "text-muted-foreground/40"
        }
      >
        ★
      </span>
    ),
  );
  return (
    <span
      className={`inline-flex gap-0.5 ${className ?? ""}`}
      data-rating={value}
    >
      {stars}
    </span>
  );
}
