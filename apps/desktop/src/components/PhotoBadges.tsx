import { cn } from "@photopipe/ui/lib/utils";
import { Flag as FlagIcon, Star } from "lucide-react";
import type { Flag } from "@/lib/core";

/// Rejects stay in view, just faded, so a change of mind is one look away.
export const rejectedFade = (flag: Flag) =>
  flag === -1 && "opacity-30 transition-opacity";

export function PickMark({
  flag,
  className,
  testid,
}: {
  flag: Flag;
  className?: string;
  testid?: string;
}) {
  if (flag !== 1) return null;
  return (
    <span
      data-testid={testid}
      title="Picked"
      className={cn(
        "flex size-4 items-center justify-center rounded-sm bg-foreground text-background",
        className,
      )}
    >
      <FlagIcon className="size-2.5 fill-current" />
    </span>
  );
}

export function ExposureBadge({
  exposure,
  className,
  testid,
  unit = "",
}: {
  exposure: number;
  className?: string;
  testid?: string;
  unit?: string;
}) {
  if (exposure === 0) return null;
  return (
    <span data-testid={testid} className={className}>
      {exposure > 0 ? "+" : ""}
      {exposure.toFixed(1)}
      {unit}
    </span>
  );
}

export function RatingBadge({
  rating,
  className,
  testid,
}: {
  rating: number;
  className?: string;
  testid?: string;
}) {
  if (rating <= 0) return null;
  return (
    <span
      data-testid={testid}
      className={`flex items-center gap-0.5 text-amber-400 ${className ?? ""}`}
    >
      <Star className="size-3 fill-amber-400" />
      {rating}
    </span>
  );
}
