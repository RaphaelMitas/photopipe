import { Button } from "@photopipe/ui/components/button";
import { ButtonGroup } from "@photopipe/ui/components/button-group";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "@photopipe/ui/components/sidebar";
import { type ReactNode, useCallback, useState } from "react";
import type { Flag } from "@/lib/core";
import { pluralize } from "@/lib/plural";
import { ShortcutTooltip } from "./ShortcutTooltip";

type RatingOp = "gte" | "eq" | "lte";

const OP_LABEL: Record<RatingOp, string> = { gte: "≥", eq: "=", lte: "≤" };

const OP_TITLE: Record<RatingOp, string> = {
  gte: "At least this many stars",
  eq: "Exactly this many stars",
  lte: "At most this many stars",
};

const STARS = [0, 1, 2, 3, 4, 5];

type Modifiers = { meta: boolean; shift: boolean };

const span = (from: number, to: number) =>
  new Set(STARS.filter((star) => star >= from && star <= to));

function starsFor(op: RatingOp, stars: number): ReadonlySet<number> {
  if (stars === 0) return new Set([0]);
  if (op === "eq") return new Set([stars]);
  return op === "gte" ? span(stars, 5) : span(0, stars);
}

const sameSet = <T,>(a: ReadonlySet<T>, b: ReadonlySet<T>) =>
  a.size === b.size && [...a].every((value) => b.has(value));

function toggled<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
}

const NONE: ReadonlySet<never> = new Set();

export function useRatingFilter() {
  const [op, setOpOnly] = useState<RatingOp>("gte");
  const [stars, setStars] = useState<ReadonlySet<number>>(NONE);
  const [flags, setFlags] = useState<ReadonlySet<Flag>>(NONE);
  const [anchor, setAnchor] = useState<number | null>(null);
  const matches = useCallback(
    (image: { rating: number; flag: Flag }) =>
      (stars.size === 0 || stars.has(image.rating)) &&
      (flags.size === 0 || flags.has(image.flag)),
    [stars, flags],
  );
  const only = (
    nextStars: ReadonlySet<number>,
    nextFlags: ReadonlySet<Flag>,
  ) => {
    const again = sameSet(stars, nextStars) && sameSet(flags, nextFlags);
    setStars(again ? NONE : nextStars);
    setFlags(again ? NONE : nextFlags);
  };
  return {
    op,
    stars,
    flags,
    key: `${[...stars].sort()}|${[...flags].sort()}`,
    setOp: (next: RatingOp) => {
      setOpOnly(next);
      if (stars.size === 0) return;
      const starred = [...stars].filter((star) => star > 0);
      const from =
        anchor !== null && starred.includes(anchor)
          ? anchor
          : Math.min(...starred);
      setStars(starred.length > 0 ? starsFor(next, from) : NONE);
    },
    clickStars: (star: number, { meta, shift }: Modifiers) => {
      if (shift && anchor !== null) {
        setStars(span(Math.min(anchor, star), Math.max(anchor, star)));
        return;
      }
      setAnchor(star);
      if (meta || shift) setStars(toggled(stars, star));
      else only(starsFor(op, star), NONE);
    },
    clickFlag: (flag: Flag, { meta, shift }: Modifiers) => {
      if (meta || shift) setFlags(toggled(flags, flag));
      else only(NONE, new Set([flag]));
    },
    matches,
    active: stars.size > 0 || flags.size > 0,
    reset: () => {
      setOpOnly("gte");
      setStars(NONE);
      setFlags(NONE);
      setAnchor(null);
    },
  };
}

export type RatingFilter = ReturnType<typeof useRatingFilter>;

export type RatingCounts = {
  stars: number[];
  picked: number;
  rejected: number;
};

export function ratingCounts(
  images: { rating: number; flag: Flag }[],
): RatingCounts {
  const counts = { stars: STARS.map(() => 0), picked: 0, rejected: 0 };
  for (const image of images) {
    counts.stars[image.rating] += 1;
    if (image.flag === 1) counts.picked += 1;
    if (image.flag === -1) counts.rejected += 1;
  }
  return counts;
}

function RatingFilterOps({
  filter,
  disabled,
}: {
  filter: RatingFilter;
  disabled?: boolean;
}) {
  const unrated = sameSet(filter.stars, new Set([0]));
  const chip = (
    testid: string,
    label: string,
    title: string,
    pressed: boolean,
    onClick: () => void,
  ) => (
    <ShortcutTooltip key={testid} label={title}>
      <Button
        size="sm"
        variant={pressed ? "secondary" : "outline"}
        aria-pressed={pressed}
        aria-label={title}
        data-testid={`filter-op-${testid}`}
        disabled={disabled}
        onClick={onClick}
        className="h-5 min-w-0 px-1.5 font-mono text-[10px]"
      >
        {label}
      </Button>
    </ShortcutTooltip>
  );
  return (
    <ButtonGroup>
      {(["gte", "eq", "lte"] as const).map((op) =>
        chip(op, OP_LABEL[op], OP_TITLE[op], filter.op === op && !unrated, () =>
          filter.setOp(op),
        ),
      )}
      {chip("unrated", "∅", "Unrated only", unrated, () =>
        filter.clickStars(0, { meta: false, shift: false }),
      )}
    </ButtonGroup>
  );
}

const BAR_AREA = 40;

const TONE = {
  stars: { on: "text-amber-400", bar: "bg-amber-400", off: "bg-border" },
  rejected: {
    on: "text-destructive",
    bar: "bg-destructive",
    off: "bg-destructive/30",
  },
  picked: {
    on: "text-success",
    bar: "bg-success",
    off: "bg-success/30",
  },
};

function HistogramBar({
  testid,
  count,
  max,
  label,
  title,
  tone,
  active,
  disabled,
  onClick,
}: {
  testid: string;
  count: number;
  max: number;
  label: string;
  title: string;
  tone: keyof typeof TONE;
  active: boolean;
  disabled?: boolean;
  onClick: (modifiers: Modifiers) => void;
}) {
  const { on, bar, off } = TONE[tone];
  return (
    <button
      type="button"
      data-testid={testid}
      disabled={disabled}
      aria-pressed={active}
      title={`${title} · ⌘ or ⇧ click to combine`}
      onClick={(event) =>
        onClick({ meta: event.metaKey || event.ctrlKey, shift: event.shiftKey })
      }
      className="group flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded p-0.5 font-mono text-[9px] transition-colors hover:bg-accent disabled:opacity-30"
    >
      <span className={active ? on : "text-muted-foreground"}>{count}</span>
      <span
        className={`w-full rounded-t-[2px] ${
          active ? bar : `${off} group-hover:bg-muted-foreground/40`
        }`}
        style={{ height: Math.max(2, (count / max) * BAR_AREA) }}
      />
      <span className={active ? on : "text-muted-foreground"}>{label}</span>
    </button>
  );
}

const Divider = () => <span className="w-px self-stretch bg-border" />;

function RatingHistogram({
  counts,
  filter,
  disabled,
}: {
  counts: RatingCounts;
  filter: RatingFilter;
  disabled?: boolean;
}) {
  const max = Math.max(...counts.stars, counts.picked, counts.rejected, 1);
  const flagBar = (flag: Flag, tone: "rejected" | "picked", label: string) => (
    <HistogramBar
      testid={`hist-${tone}`}
      count={counts[tone]}
      max={max}
      label={label}
      title={`${counts[tone]} ${tone}`}
      tone={tone}
      active={!disabled && filter.flags.has(flag)}
      disabled={disabled}
      onClick={(modifiers) => filter.clickFlag(flag, modifiers)}
    />
  );
  return (
    <div className="flex items-end gap-1">
      {flagBar(-1, "rejected", "✕")}
      <Divider />
      {counts.stars.map((count, rating) => (
        <HistogramBar
          key={rating}
          testid={`hist-${rating}`}
          count={count}
          max={max}
          label={rating === 0 ? "∅" : String(rating)}
          title={
            rating === 0
              ? `${count} unrated`
              : `${count} rated ${pluralize(rating, "star")}`
          }
          tone="stars"
          active={!disabled && filter.stars.has(rating)}
          disabled={disabled}
          onClick={(modifiers) => filter.clickStars(rating, modifiers)}
        />
      ))}
      <Divider />
      {flagBar(1, "picked", "✓")}
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
  counts: RatingCounts;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="justify-between">
        Rating
        <RatingFilterOps filter={filter} disabled={disabled} />
      </SidebarGroupLabel>
      <SidebarGroupContent className="px-2 py-1">
        <RatingHistogram counts={counts} filter={filter} disabled={disabled} />
        {children}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
