import { Star } from "lucide-react";

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
