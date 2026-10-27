import { Button } from "@photopipe/ui/components/button";
import { ButtonGroup } from "@photopipe/ui/components/button-group";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "@photopipe/ui/components/sidebar";
import { type ReactNode, useCallback, useState } from "react";
import { pluralize } from "@/lib/plural";

type RatingOp = "gte" | "eq" | "lte" | "unrated";

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

function matchesRatingFilter(
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

export function useRatingFilter() {
  const [op, setOp] = useState<RatingOp>("gte");
  const [stars, setStarsOnly] = useState(0);
  const matches = useCallback(
    (image: { rating: number }) => matchesRatingFilter(image.rating, op, stars),
    [op, stars],
  );
  return {
    op,
    stars,
    setOp,
    setStars: (next: number) => {
      setStarsOnly(next);
      if (next > 0 && op === "unrated") setOp("gte");
    },
    matches,
    active: op === "unrated" || stars > 0,
    reset: () => {
      setStarsOnly(0);
      setOp("gte");
    },
  };
}

export type RatingFilter = ReturnType<typeof useRatingFilter>;

export function ratingCounts(images: { rating: number }[]): number[] {
  const counts = [0, 0, 0, 0, 0, 0];
  for (const image of images) {
    counts[Math.min(Math.max(image.rating, 0), 5)] += 1;
  }
  return counts;
}

function RatingFilterOps({
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

function RatingHistogram({
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
                : `${count} rated ${pluralize(rating, "star")}`
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

export function RatingFilterGroup({
  filter,
  counts,
  disabled,
  children,
}: {
  filter: RatingFilter;
  counts: number[];
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="justify-between">
        Rating
        <RatingFilterOps
          op={filter.op}
          disabled={disabled}
          onOp={filter.setOp}
        />
      </SidebarGroupLabel>
      <SidebarGroupContent className="px-2 py-1">
        <RatingHistogram
          counts={counts}
          op={filter.op}
          stars={filter.stars}
          disabled={disabled}
          onOp={filter.setOp}
          onStars={filter.setStars}
        />
        {children}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
