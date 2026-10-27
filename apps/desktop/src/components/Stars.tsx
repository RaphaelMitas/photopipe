import { cn } from "@photopipe/ui/lib/utils";
import { Flag as FlagIcon, Star, X } from "lucide-react";
import type { Flag } from "@/lib/core";

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
        title={star === value ? "Clear rating (0)" : `Rate ${star} (${star})`}
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

const FLAG_BUTTONS = [
  {
    flag: 1,
    key: "P",
    label: "Pick",
    icon: FlagIcon,
    on: "bg-foreground text-background",
  },
  {
    flag: -1,
    key: "X",
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
      {FLAG_BUTTONS.map(({ flag, key, label, icon: Icon, on }) => (
        <button
          key={flag}
          type="button"
          data-testid={`flag-${flag === 1 ? "pick" : "reject"}`}
          aria-pressed={value === flag}
          onClick={() => onFlag(flag)}
          title={value === flag ? `Clear flag (U)` : `${label} (${key})`}
          className={cn(
            "flex size-5 items-center justify-center rounded border border-border text-muted-foreground transition-colors hover:text-foreground",
            value === flag && `border-transparent ${on} hover:text-current`,
          )}
        >
          <Icon className="size-3" />
        </button>
      ))}
    </span>
  );
}
