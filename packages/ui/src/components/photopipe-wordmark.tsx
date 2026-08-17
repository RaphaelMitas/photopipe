import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

/** Split the way the brand lockup splits it. Typography stays with the caller. */
export function PhotopipeWordmark({
  className,
  ...props
}: ComponentProps<"span">) {
  return (
    <span className={cn("text-foreground", className)} {...props}>
      Photo<span className="text-muted-foreground">pipe</span>
    </span>
  );
}
