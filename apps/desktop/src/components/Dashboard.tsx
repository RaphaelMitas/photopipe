import { Plus } from "lucide-react";
import type { Shoot, Stage } from "@/lib/core";
import { Card, CardContent } from "./ui/card";

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
  onNewProject: () => void;
};

export function Dashboard({ shoots, onOpen, onNewProject }: Props) {
  return (
    <div className="grid grid-cols-1 gap-3 p-6 sm:grid-cols-2 lg:grid-cols-3">
      {/* Starting a shoot is the first thing this page offers, not a
          hidden menu item — the project structure comes ready to go. */}
      <button
        type="button"
        data-testid="new-project"
        onClick={onNewProject}
        className="flex min-h-24 items-center justify-center gap-2 rounded-xl border border-dashed text-muted-foreground text-sm transition-colors hover:border-ring hover:text-foreground"
      >
        <Plus className="size-4" />
        New project
      </button>
      {shoots.map((shoot) => (
        <Card
          key={shoot.name}
          className="gap-0 py-0 transition-shadow hover:ring-ring"
        >
          <button
            type="button"
            data-testid={`shoot-${shoot.name}`}
            onClick={() => onOpen(shoot.name)}
            className="w-full text-left"
          >
            <CardContent className="p-4">
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
              {shoot.notes && (
                <p
                  data-testid="shoot-notes"
                  className="mt-1 truncate text-xs text-muted-foreground/70"
                >
                  {shoot.notes}
                </p>
              )}
              <div className="mt-3">
                <StageCounts counts={shoot.counts} />
              </div>
            </CardContent>
          </button>
        </Card>
      ))}
    </div>
  );
}
