import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { fileSrc, type ImageGroup, type Shoot } from "@/lib/core";
import {
  useImages,
  useRenameProject,
  useThumbnail,
  useUpdateProject,
} from "@/lib/queries";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Skeleton } from "./ui/skeleton";
import { Textarea } from "./ui/textarea";

function CoverChoice({
  image,
  chosen,
  onChoose,
}: {
  image: ImageGroup;
  chosen: boolean;
  onChoose: () => void;
}) {
  const thumb = useThumbnail(image.files[image.files.length - 1]);
  return (
    <button
      type="button"
      data-testid="cover-choice"
      data-stem={image.stem}
      data-chosen={chosen}
      title={image.stem}
      onClick={onChoose}
      className={cn(
        "relative size-16 shrink-0 overflow-hidden rounded-md",
        chosen ? "ring-2 ring-primary" : "opacity-70 hover:opacity-100",
      )}
    >
      {thumb.data ? (
        <img
          src={fileSrc(thumb.data)}
          alt={image.stem}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <Skeleton className="h-full w-full rounded-none" />
      )}
      {chosen && (
        <span className="absolute right-1 bottom-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-3" strokeWidth={3} />
        </span>
      )}
    </button>
  );
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shoot: Shoot | undefined;
  /// Renaming changes the folder, so the app has to follow it.
  onRenamed: (shoot: string) => void;
};

/// Everything about one project: what it's called, when it was, what it says,
/// and which frame represents it. Name and date rename the folder on disk,
/// because the folder is the project.
export function ShootSettingsDialog({
  open: isOpen,
  onOpenChange,
  shoot,
  onRenamed,
}: Props) {
  const images = useImages(isOpen && shoot ? shoot.name : null);
  const update = useUpdateProject();
  const rename = useRenameProject();

  const [name, setName] = useState("");
  const [day, setDay] = useState("");
  const [notes, setNotes] = useState("");
  const [cover, setCover] = useState<string | null>(null);

  // Reload the draft each time the dialog opens on a project.
  useEffect(() => {
    if (!isOpen || !shoot) return;
    setName(shoot.project ?? shoot.name);
    setDay(shoot.day ?? "");
    setNotes(shoot.notes);
    setCover(shoot.cover);
  }, [isOpen, shoot]);

  if (!shoot) return null;

  const renames =
    day !== "" && (name !== (shoot.project ?? shoot.name) || day !== shoot.day);

  const submit = async () => {
    await update.mutateAsync({ shoot: shoot.name, notes, cover });
    if (renames) {
      const result = await rename.mutateAsync({
        shoot: shoot.name,
        day,
        name,
      });
      onRenamed(result.shoot);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">Project settings</DialogTitle>
          <DialogDescription>
            Name and date rename the folder; the rest is metadata.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="shoot-name">Project</Label>
              <Input
                id="shoot-name"
                data-testid="shoot-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="shoot-day">Date</Label>
              <Input
                id="shoot-day"
                data-testid="shoot-day"
                type="date"
                value={day}
                onChange={(event) => setDay(event.target.value)}
              />
            </div>
          </div>
          {renames && (
            <p
              data-testid="rename-preview"
              className="font-mono text-[10px] text-muted-foreground"
            >
              Folder becomes {day}_{name}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="shoot-notes">Notes</Label>
            <Textarea
              id="shoot-notes"
              data-testid="shoot-notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Cover</Label>
              {cover && (
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="cover-clear"
                  onClick={() => setCover(null)}
                  className="h-6 text-[10px] text-muted-foreground"
                >
                  Use the first photo
                </Button>
              )}
            </div>
            {images.data && images.data.length > 0 ? (
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                {images.data.map((image) => (
                  <CoverChoice
                    key={image.stem}
                    image={image}
                    chosen={cover === image.stem}
                    onChoose={() =>
                      setCover(cover === image.stem ? null : image.stem)
                    }
                  />
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">
                No photos yet. The cover appears once this project has some.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            data-testid="save-shoot-settings"
            disabled={update.isPending || rename.isPending}
            onClick={submit}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
