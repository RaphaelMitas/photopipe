import { cn } from "@photopipe/ui/lib/utils";

export function ProgressBar({
  share,
  testid,
  className,
  barClassName,
}: {
  share: number;
  testid?: string;
  className?: string;
  barClassName?: string;
}) {
  return (
    <span
      className={cn("h-0.5 overflow-hidden rounded-full bg-border", className)}
    >
      <span
        data-testid={testid}
        className={cn(
          "block h-full bg-primary transition-[width] duration-200",
          barClassName,
        )}
        style={{
          width: `${Math.round(Math.min(Math.max(share, 0), 1) * 100)}%`,
        }}
      />
    </span>
  );
}
