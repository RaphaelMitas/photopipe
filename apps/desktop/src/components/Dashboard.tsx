import type { Shoot, Stage } from "@/lib/core";

const STAGE_STYLE: Record<Stage, string> = {
  raw: "text-muted-foreground",
  denoised: "text-sky-400",
  export: "text-emerald-400",
};

const STAGE_LABEL: Record<Stage, string> = {
  raw: "raw",
  denoised: "denoised",
  export: "exported",
};

export function StageCounts({ counts }: { counts: Record<Stage, number> }) {
  return (
    <span className="flex gap-3 font-mono text-xs">
      {(Object.keys(STAGE_LABEL) as Stage[]).map((stage) => (
        <span
          key={stage}
          className={
            counts[stage] > 0 ? STAGE_STYLE[stage] : "text-muted-foreground/40"
          }
        >
          {counts[stage] ?? 0} {STAGE_LABEL[stage]}
        </span>
      ))}
    </span>
  );
}

type Props = {
  shoots: Shoot[];
  onOpen: (shoot: string) => void;
};

export function Dashboard({ shoots, onOpen }: Props) {
  if (shoots.length === 0) {
    return (
      <p
        className="p-8 text-sm text-muted-foreground"
        data-testid="empty-library"
      >
        No shoots found — folders named{" "}
        <span className="font-mono">&lt;YYYY-MM-DD&gt;_&lt;project&gt;</span>{" "}
        with ARW/DNG/JPG files appear here.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 p-6 sm:grid-cols-2 lg:grid-cols-3">
      {shoots.map((shoot) => (
        <button
          type="button"
          key={shoot.name}
          data-testid={`shoot-${shoot.name}`}
          onClick={() => onOpen(shoot.name)}
          className="rounded-xl border bg-card p-4 text-left text-card-foreground transition-colors hover:border-ring"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate font-heading font-medium">
              {shoot.project ?? shoot.name}
            </span>
            {shoot.day && (
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {shoot.day}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {shoot.imageCount} photos
          </div>
          <div className="mt-3">
            <StageCounts counts={shoot.counts} />
          </div>
        </button>
      ))}
    </div>
  );
}
