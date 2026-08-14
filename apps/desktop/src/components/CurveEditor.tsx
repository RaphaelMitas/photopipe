import { RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Edit } from "@/lib/core";
import { type CurvePoint, isIdentityCurve, sampleCurve } from "@/lib/curve";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

export type CurveChannel = "rgb" | "red" | "green" | "blue";

const CHANNELS: Array<{
  channel: CurveChannel;
  key: keyof Pick<Edit, "curveRGB" | "curveRed" | "curveGreen" | "curveBlue">;
  dot: string;
  stroke: string;
}> = [
  { channel: "rgb", key: "curveRGB", dot: "bg-orange-400", stroke: "#fb923c" },
  { channel: "red", key: "curveRed", dot: "bg-red-500", stroke: "#ef4444" },
  {
    channel: "green",
    key: "curveGreen",
    dot: "bg-green-500",
    stroke: "#22c55e",
  },
  { channel: "blue", key: "curveBlue", dot: "bg-blue-500", stroke: "#3b82f6" },
];

const W = 200;
const H = 140;
const HIT_RADIUS = 10;
const MIN_GAP = 0.01;

const toSvg = (point: CurvePoint) => ({
  x: point.x * W,
  y: (1 - point.y) * H,
});

function materialized(points: CurvePoint[]): CurvePoint[] {
  return points.length >= 2
    ? points
    : [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ];
}

function curvePath(points: CurvePoint[]): string {
  return sampleCurve(points, 64)
    .map((y, i, samples) => {
      const svg = toSvg({ x: i / (samples.length - 1), y });
      return `${i === 0 ? "M" : "L"}${svg.x.toFixed(1)} ${svg.y.toFixed(1)}`;
    })
    .join(" ");
}

// Luminance histogram of the current render, drawn behind the curve. The
// asset protocol may refuse canvas readback; then the curve stands alone.
function useHistogram(src: string | undefined): number[] | null {
  const [bins, setBins] = useState<number[] | null>(null);
  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(image, 0, 0, 64, 64);
        const { data } = ctx.getImageData(0, 0, 64, 64);
        const next = new Array<number>(48).fill(0);
        for (let i = 0; i < data.length; i += 4) {
          const luminance =
            (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) /
            255;
          next[Math.min(47, Math.floor(luminance * 48))] += 1;
        }
        const max = Math.max(...next);
        if (!cancelled && max > 0) {
          setBins(next.map((count) => Math.sqrt(count / max)));
        }
      } catch {
        if (!cancelled) setBins(null);
      }
    };
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);
  return bins;
}

function histogramPath(bins: number[]): string {
  const step = W / bins.length;
  const top = bins
    .map(
      (value, i) =>
        `L${(i * step + step / 2).toFixed(1)} ${(H - value * H).toFixed(1)}`,
    )
    .join(" ");
  return `M0 ${H} ${top} L${W} ${H} Z`;
}

type Props = {
  edit: Edit;
  imageSrc?: string;
  onChange: (partial: Partial<Edit>) => void;
};

export function CurveEditor({ edit, imageSrc, onChange }: Props) {
  const [channel, setChannel] = useState<CurveChannel>("rgb");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragIndex = useRef<number | null>(null);
  const active =
    CHANNELS.find((entry) => entry.channel === channel) ?? CHANNELS[0];
  const points = materialized(edit[active.key]);
  const histogram = useHistogram(imageSrc);

  const emit = (next: CurvePoint[]) => {
    onChange({ [active.key]: isIdentityCurve(next) ? [] : next });
  };

  const eventPoint = (event: React.PointerEvent): CurvePoint => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1),
      y: Math.min(Math.max(1 - (event.clientY - rect.top) / rect.height, 0), 1),
    };
  };

  const onPointerDown = (event: React.PointerEvent) => {
    const at = eventPoint(event);
    const svgAt = toSvg(at);
    let index = points.findIndex((point) => {
      const svg = toSvg(point);
      return Math.hypot(svg.x - svgAt.x, svg.y - svgAt.y) <= HIT_RADIUS;
    });
    if (index === -1) {
      const insertAt = points.findIndex((point) => point.x > at.x);
      index = insertAt === -1 ? points.length : insertAt;
      emit([...points.slice(0, index), at, ...points.slice(index)]);
    }
    dragIndex.current = index;
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const index = dragIndex.current;
    if (index === null) return;
    const at = eventPoint(event);
    const lower = index === 0 ? 0 : points[index - 1].x + MIN_GAP;
    const upper =
      index === points.length - 1 ? 1 : points[index + 1].x - MIN_GAP;
    const moved = { x: Math.min(Math.max(at.x, lower), upper), y: at.y };
    emit(points.map((point, i) => (i === index ? moved : point)));
  };

  const onPointerUp = () => {
    dragIndex.current = null;
  };

  const onDoubleClick = (event: React.MouseEvent) => {
    if (points.length <= 2) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const atX = ((event.clientX - rect.left) / rect.width) * W;
    const atY = ((event.clientY - rect.top) / rect.height) * H;
    const index = points.findIndex((point) => {
      const p = toSvg(point);
      return Math.hypot(p.x - atX, p.y - atY) <= HIT_RADIUS;
    });
    if (index === -1) return;
    dragIndex.current = null;
    emit(points.filter((_, i) => i !== index));
  };

  return (
    <div data-testid="curve-editor" className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        {CHANNELS.map((entry) => (
          <button
            key={entry.channel}
            type="button"
            data-testid={`curve-channel-${entry.channel}`}
            aria-pressed={channel === entry.channel}
            onClick={() => setChannel(entry.channel)}
            className={cn(
              "size-4 rounded-full transition-opacity",
              entry.dot,
              channel === entry.channel
                ? "opacity-100 ring-2 ring-white/40"
                : "opacity-35 hover:opacity-70",
            )}
            title={entry.channel === "rgb" ? "RGB" : entry.channel}
          />
        ))}
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          data-testid="curve-reset"
          onClick={() => onChange({ [active.key]: [] })}
          disabled={isIdentityCurve(edit[active.key])}
          title="Reset curve"
          className="size-6 text-muted-foreground"
        >
          <RotateCcw />
        </Button>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Tone curve"
        className="w-full touch-none rounded-md border border-border bg-black/40 select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        {histogram && (
          <path d={histogramPath(histogram)} fill="rgba(255,255,255,0.08)" />
        )}
        {[0.25, 0.5, 0.75].map((fraction) => (
          <g key={fraction} stroke="rgba(255,255,255,0.07)">
            <line x1={fraction * W} y1={0} x2={fraction * W} y2={H} />
            <line x1={0} y1={fraction * H} x2={W} y2={fraction * H} />
          </g>
        ))}
        <path
          d={curvePath(points)}
          fill="none"
          stroke={active.stroke}
          strokeWidth={1.5}
        />
        {points.map((point) => {
          const svg = toSvg(point);
          return (
            <circle
              key={point.x}
              cx={svg.x}
              cy={svg.y}
              r={4}
              fill="white"
              stroke={active.stroke}
              strokeWidth={1.5}
              className="cursor-grab"
            />
          );
        })}
      </svg>
    </div>
  );
}
