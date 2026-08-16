import { Button } from "@photopipe/ui/components/button";
import { ButtonGroup } from "@photopipe/ui/components/button-group";

export type RatingOp = "gte" | "eq" | "lte" | "unrated";

const OP_LABEL: Record<RatingOp, string> = {
  gte: "≥",
  eq: "=",
  lte: "≤",
  unrated: "∅",
};

const OP_TITLE: Record<RatingOp, string> = {
  gte: "At least this many stars",
  eq: "Exactly this many stars",
  lte: "At most this many stars",
  unrated: "Unrated only",
};

export function matchesRatingFilter(
  rating: number,
  op: RatingOp,
  stars: number,
): boolean {
  if (op === "unrated") return rating === 0;
  if (stars === 0) return true;
  switch (op) {
    case "gte":
      return rating >= stars;
    case "eq":
      return rating === stars;
    case "lte":
      return rating <= stars;
  }
}

export function ratingCounts(images: { rating: number }[]): number[] {
  const counts = [0, 0, 0, 0, 0, 0];
  for (const image of images) {
    counts[Math.min(Math.max(image.rating, 0), 5)] += 1;
  }
  return counts;
}

export function RatingFilterOps({
  op,
  disabled,
  onOp,
}: {
  op: RatingOp;
  disabled?: boolean;
  onOp: (op: RatingOp) => void;
}) {
  return (
    <ButtonGroup>
      {(["gte", "eq", "lte", "unrated"] as const).map((candidate) => (
        <Button
          key={candidate}
          size="sm"
          variant={op === candidate ? "secondary" : "outline"}
          aria-pressed={op === candidate}
          data-testid={`filter-op-${candidate}`}
          disabled={disabled}
          onClick={() => onOp(candidate)}
          title={OP_TITLE[candidate]}
          className="h-5 min-w-0 px-1.5 font-mono text-[10px]"
        >
          {OP_LABEL[candidate]}
        </Button>
      ))}
    </ButtonGroup>
  );
}

const BAR_AREA = 40;

export function RatingHistogram({
  counts,
  op,
  stars,
  disabled,
  onOp,
  onStars,
}: {
  counts: number[];
  op: RatingOp;
  stars: number;
  disabled?: boolean;
  onOp: (op: RatingOp) => void;
  onStars: (stars: number) => void;
}) {
  const max = Math.max(...counts, 1);
  return (
    <div className="flex items-end gap-1">
      {counts.map((count, rating) => {
        const active =
          !disabled &&
          (op === "unrated" || stars > 0) &&
          matchesRatingFilter(rating, op, stars);
        return (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: the index IS the rating — a stable identity, not a list position
            key={rating}
            type="button"
            data-testid={`hist-${rating}`}
            disabled={disabled}
            aria-pressed={active}
            title={
              rating === 0
                ? `${count} unrated`
                : `${count} rated ${rating} star${rating === 1 ? "" : "s"}`
            }
            onClick={() =>
              rating === 0
                ? onOp(op === "unrated" ? "gte" : "unrated")
                : onStars(stars === rating && op !== "unrated" ? 0 : rating)
            }
            className="group flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded p-0.5 font-mono text-[9px] transition-colors hover:bg-accent disabled:opacity-30"
          >
            <span
              className={active ? "text-amber-400" : "text-muted-foreground"}
            >
              {count}
            </span>
            <span
              className={`w-full rounded-t-[2px] ${
                active
                  ? "bg-amber-400"
                  : "bg-border group-hover:bg-muted-foreground/40"
              }`}
              style={{ height: Math.max(2, (count / max) * BAR_AREA) }}
            />
            <span
              className={active ? "text-amber-400" : "text-muted-foreground"}
            >
              {rating === 0 ? "∅" : rating}
            </span>
          </button>
        );
      })}
    </div>
  );
}
