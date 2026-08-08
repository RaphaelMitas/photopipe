import { Star } from "lucide-react";
import { Button } from "./ui/button";
import { ButtonGroup } from "./ui/button-group";

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

/// Stars = 0 means the filter is off — except for "unrated", which needs
/// no star threshold and matches exactly the rating-0 images.
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

/// Tiny comparator chips — sized to sit inline with the group heading.
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

/// Star threshold; clicking the active count clears the filter. The fill
/// always runs up to the count — the comparator chip carries the mode.
export function RatingFilterStars({
  stars,
  disabled,
  muted,
  onStars,
}: {
  stars: number;
  disabled?: boolean;
  /// Stars don't apply (unrated mode) but stay clickable to switch back.
  muted?: boolean;
  onStars: (stars: number) => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          data-testid={`filter-${star}`}
          disabled={disabled}
          onClick={() => onStars(stars === star ? 0 : star)}
          className="rounded p-0.5 transition-colors hover:text-amber-300 disabled:opacity-30"
        >
          <Star
            className={`size-4 ${
              !disabled && !muted && stars > 0 && star <= stars
                ? "fill-amber-400 text-amber-400"
                : "text-muted-foreground/50"
            }`}
          />
        </button>
      ))}
    </div>
  );
}
