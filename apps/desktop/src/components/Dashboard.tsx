import { Button } from "@photopipe/ui/components/button";
import { Card, CardContent } from "@photopipe/ui/components/card";
import { Skeleton } from "@photopipe/ui/components/skeleton";
import { Images, Plus, Settings2 } from "lucide-react";
import { fileSrc, type Shoot } from "@/lib/core";
import { useThumbnail } from "@/lib/queries";

function Cover({ path }: { path: string | null }) {
  const thumb = useThumbnail(path ? { path, mtime: 0 } : undefined);
  if (!path) {
    return (
      <div className="flex aspect-[3/2] w-full items-center justify-center rounded-t-xl bg-muted/40">
        <Images className="size-6 text-muted-foreground/40" />
      </div>
    );
  }
  if (!thumb.data) {
    return (
      <Skeleton className="aspect-[3/2] w-full rounded-t-xl rounded-b-none" />
    );
  }
  return (
    <img
      data-testid="shoot-cover"
      src={fileSrc(thumb.data)}
      alt=""
      loading="lazy"
      className="aspect-[3/2] w-full rounded-t-xl object-cover"
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
          <Button
            variant="ghost"
            size="icon"
            data-testid={`shoot-settings-${shoot.name}`}
            title="Project settings"
            onClick={() => onSettings(shoot.name)}
            className="absolute top-2 right-2 z-10 size-7 bg-background/70 text-muted-foreground opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          >
            <Settings2 />
          </Button>
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
