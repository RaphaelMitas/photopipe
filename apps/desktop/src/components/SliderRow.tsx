import { Button } from "@photopipe/ui/components/button";
import { Slider } from "@photopipe/ui/components/slider";
import { cn } from "@photopipe/ui/lib/utils";
import { RotateCcw } from "lucide-react";
import { type PointerEvent, useRef } from "react";
import type { ActionId } from "@/lib/keymap";
import { ShortcutTooltip } from "./ShortcutTooltip";

const SCRUB_SLOP_PX = 6;

type Range = { value: number; min: number; max: number; step: number };

// On a touch screen the whole row scrubs from the current value, the way an
// iOS slider does: a tap never jumps it, and a vertical swipe scrolls the panel.
function useTouchScrub(
  { value, min, max, step }: Range,
  onValue: (value: number) => void,
) {
  const scrub = useRef<{
    x: number;
    value: number;
    width: number;
    moving: boolean;
  } | null>(null);
  const end = () => {
    scrub.current = null;
  };
  return {
    onPointerDown: (event: PointerEvent<HTMLSpanElement>) => {
      if (event.pointerType !== "touch") return;
      // Keeps Radix from jumping the thumb to the finger.
      event.preventDefault();
      scrub.current = {
        x: event.clientX,
        value,
        width: event.currentTarget.getBoundingClientRect().width,
        moving: false,
      };
    },
    onPointerMove: (event: PointerEvent<HTMLSpanElement>) => {
      const from = scrub.current;
      if (!from || from.width <= 0) return;
      if (!from.moving) {
        const dx = event.clientX - from.x;
        if (Math.abs(dx) < SCRUB_SLOP_PX) return;
        from.moving = true;
        from.x += Math.sign(dx) * SCRUB_SLOP_PX;
      }
      const raw =
        from.value + ((event.clientX - from.x) / from.width) * (max - min);
      const stepped = min + Math.round((raw - min) / step) * step;
      // toFixed drops the float noise that 0.05 steps pile up.
      const next = Number(Math.min(Math.max(stepped, min), max).toFixed(6));
      if (next !== value) onValue(next);
    },
    onPointerUp: end,
    onPointerCancel: end,
  };
}

export function SliderRow({
  label,
  value,
  display,
  min,
  max,
  step,
  testid,
  resetLabel,
  resetAction,
  trackClassName,
  onValue,
  onReset,
}: Range & {
  label: string;
  display: string;
  testid: string;
  resetLabel: string;
  resetAction?: ActionId;
  trackClassName?: string;
  onValue: (value: number) => void;
  onReset: () => void;
}) {
  const scrub = useTouchScrub({ value, min, max, step }, onValue);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="flex-1 text-right font-mono text-foreground/90 tabular-nums">
          {display}
        </span>
        <ShortcutTooltip label={resetLabel} action={resetAction}>
          <Button
            variant="ghost"
            size="icon"
            data-testid={`${testid}-reset`}
            aria-label={resetLabel}
            onClick={onReset}
            className="size-5 text-muted-foreground"
          >
            <RotateCcw />
          </Button>
        </ShortcutTooltip>
      </div>
      <Slider
        data-testid={testid}
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([next]) => onValue(next)}
        trackClassName={cn("data-horizontal:h-1.5", trackClassName)}
        rangeClassName="bg-transparent"
        className="**:data-[slot=slider-thumb]:size-3 pointer-coarse:h-11 pointer-coarse:touch-pan-y pointer-coarse:**:data-[slot=slider-thumb]:size-5"
        {...scrub}
      />
    </div>
  );
}
