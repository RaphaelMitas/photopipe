import { cn } from "@photopipe/ui/lib/utils";
import { Check, Star, X } from "lucide-react";
import type { Flag } from "@/lib/core";
import { RATING_ACTIONS } from "@/lib/keymap";
import { ShortcutTooltip } from "./ShortcutTooltip";

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
  const stars = [1, 2, 3, 4, 5].map((star) => {
    if (!onRate) {
      return (
        <span key={star}>
          <StarIcon filled={star <= value} />
        </span>
      );
    }
    const clears = star === value;
    const label = clears ? "Clear rating" : `Rate ${star}`;
    return (
      <ShortcutTooltip
        key={star}
        label={label}
        action={RATING_ACTIONS[clears ? 0 : star]}
      >
        <button
          type="button"
          data-testid={`star-${star}`}
          aria-label={label}
          onClick={() => onRate(clears ? 0 : star)}
          className="transition-transform hover:scale-110"
        >
          <StarIcon filled={star <= value} />
        </button>
      </ShortcutTooltip>
    );
  });
  return (
    <span
      className={`inline-flex items-center gap-0.5 ${className ?? ""}`}
      data-rating={value}
    >
      {stars}
    </span>
  );
}

const FLAG_BUTTONS = [
  {
    flag: 1,
    action: "flag.pick",
    label: "Pick",
    icon: Check,
    on: "bg-success text-background",
  },
  {
    flag: -1,
    action: "flag.reject",
    label: "Reject",
    icon: X,
    on: "bg-destructive text-white",
  },
] as const;

export function FlagButtons({
  value,
  onFlag,
}: {
  value: Flag;
  onFlag: (flag: Flag) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1" data-flag={value}>
      {FLAG_BUTTONS.map(({ flag, action, label, icon: Icon, on }) => (
        <ShortcutTooltip
          key={flag}
          label={value === flag ? "Clear flag" : label}
          action={value === flag ? "flag.clear" : action}
        >
          <button
            type="button"
            data-testid={`flag-${flag === 1 ? "pick" : "reject"}`}
            aria-label={label}
            aria-pressed={value === flag}
            onClick={() => onFlag(flag)}
            className={cn(
              "flex size-5 items-center justify-center rounded border border-border text-muted-foreground transition-colors hover:text-foreground",
              value === flag && `border-transparent ${on} hover:text-current`,
            )}
          >
            <Icon className="size-3" />
          </button>
        </ShortcutTooltip>
      ))}
    </span>
  );
}
