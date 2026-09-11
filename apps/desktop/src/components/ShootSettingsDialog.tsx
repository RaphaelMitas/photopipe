import { Button } from "@photopipe/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@photopipe/ui/components/dialog";
import { Input } from "@photopipe/ui/components/input";
import { Label } from "@photopipe/ui/components/label";
import { Skeleton } from "@photopipe/ui/components/skeleton";
import { Textarea } from "@photopipe/ui/components/textarea";
import { cn } from "@photopipe/ui/lib/utils";
import { Check } from "lucide-react";
import { useState } from "react";
import { FolderNameField } from "@/components/FolderNameField";
import { fileSrc, type ImageFile, type Shoot } from "@/lib/core";
import {
  dateInFolderDefault,
  hasDateInFolder,
  projectFolder,
} from "@/lib/projectFolder";
import { useImages, useThumbnail, useUpdateProject } from "@/lib/queries";

function CoverChoice({
  image,
  chosen,
  onChoose,
}: {
  image: ImageFile;
  chosen: boolean;
  onChoose: () => void;
}) {
  const thumb = useThumbnail(image);
  return (
    <button
      type="button"
      data-testid="cover-choice"
      data-path={image.rel}
      data-chosen={chosen}
      title={image.rel}
      onClick={onChoose}
      className={cn(
        "relative size-16 shrink-0 overflow-hidden rounded-md",
        chosen ? "ring-2 ring-primary" : "opacity-70 hover:opacity-100",
      )}
    >
      {thumb.data ? (
        <img
          src={fileSrc(thumb.data)}
          alt={image.rel}
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
  onSaved: (shoot: string) => void;
};

export function ShootSettingsDialog({
  open,
  onOpenChange,
  shoot,
  onSaved,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {shoot && (
          <ShootSettingsForm
            shoot={shoot}
            onCancel={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ShootSettingsForm({
  shoot,
  onCancel,
  onSaved,
}: {
  shoot: Shoot;
  onCancel: () => void;
  onSaved: (shoot: string) => void;
}) {
  const images = useImages(shoot.name);
  const update = useUpdateProject();

  const [name, setName] = useState(shoot.project);
  const [day, setDay] = useState(shoot.day ?? "");
  const [dateInFolder, setDateInFolder] = useState(() =>
    shoot.day ? hasDateInFolder(shoot) : dateInFolderDefault.read(),
  );
  const [notes, setNotes] = useState(shoot.notes);
  const [cover, setCover] = useState(shoot.cover);
  const folder = projectFolder(name, day, dateInFolder);

  const submit = () => {
    update.mutate(
      {
        shoot: shoot.name,
        name: name.trim(),
        day: day || null,
        dateInFolder,
        notes,
        cover,
      },
      { onSuccess: (result) => onSaved(result.shoot) },
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-heading">Project settings</DialogTitle>
        <DialogDescription>
          Changing the folder name moves it; the rest is metadata.
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
        <FolderNameField
          folder={folder}
          dateInFolder={dateInFolder}
          onDateInFolderChange={setDateInFolder}
        />

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
                  key={image.path}
                  image={image}
                  chosen={cover === image.rel}
                  onChoose={() =>
                    setCover(cover === image.rel ? null : image.rel)
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
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          data-testid="save-shoot-settings"
          disabled={!folder || update.isPending}
          onClick={submit}
        >
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
