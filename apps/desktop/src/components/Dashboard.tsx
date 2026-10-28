import { Button } from "@photopipe/ui/components/button";
import { Card, CardContent } from "@photopipe/ui/components/card";
import { Images, Plus, Settings2 } from "lucide-react";
import type { Shoot } from "@/lib/core";
import { pluralize } from "@/lib/plural";
import { ShortcutTooltip } from "./ShortcutTooltip";
import { Thumbnail } from "./Thumbnail";

function Cover({ path }: { path: string | null }) {
  if (!path) {
    return (
      <div className="flex aspect-[3/2] w-full items-center justify-center rounded-t-xl bg-muted/40">
        <Images className="size-6 text-muted-foreground/40" />
      </div>
    );
  }
  return (
    <Thumbnail
      file={{ path, mtime: 0 }}
      alt=""
      data-testid="shoot-cover"
      className="aspect-[3/2] w-full rounded-t-xl"
    />
  );
}

type Props = {
  shoots: Shoot[];
  onOpen: (shoot: string) => void;
  onNewProject: () => void;
  onSettings: (shoot: string) => void;
};

export function Dashboard({ shoots, onOpen, onNewProject, onSettings }: Props) {
  return (
    <div className="grid grid-cols-1 gap-3 p-6 sm:grid-cols-2 lg:grid-cols-3">
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
          className="group relative gap-0 overflow-hidden py-0 transition-shadow hover:ring-ring"
        >
          <ShortcutTooltip label="Project settings">
            <Button
              aria-label="Project settings"
              variant="ghost"
              size="icon"
              data-testid={`shoot-settings-${shoot.name}`}
              onClick={() => onSettings(shoot.name)}
              className="absolute top-2 right-2 z-10 size-7 bg-background/70 text-muted-foreground opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            >
              <Settings2 />
            </Button>
          </ShortcutTooltip>
          <button
            type="button"
            data-testid={`shoot-${shoot.name}`}
            onClick={() => onOpen(shoot.name)}
            className="w-full text-left"
          >
            <Cover path={shoot.coverPath} />
            <CardContent className="p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-heading font-medium">
                  {shoot.name}
                </span>
                {shoot.day && (
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {shoot.day}
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {pluralize(shoot.imageCount, "photo")}
              </div>
              {shoot.notes && (
                <p
                  data-testid="shoot-card-notes"
                  className="mt-1 truncate text-xs text-muted-foreground/70"
                >
                  {shoot.notes}
                </p>
              )}
            </CardContent>
          </button>
        </Card>
      ))}
    </div>
  );
}
