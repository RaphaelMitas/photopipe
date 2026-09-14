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
import { cn } from "@photopipe/ui/lib/utils";
import { Check } from "lucide-react";
import { useRef, useState } from "react";
import { ProjectFields } from "@/components/ProjectFields";
import { fileSrc, type ImageFile, type Shoot } from "@/lib/core";
import type { ProjectDraft } from "@/lib/project";
import {
  useCaptureDate,
  useImages,
  useThumbnail,
  useUpdateProject,
} from "@/lib/queries";

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

/// Empty until you focus it, then it suggests the first photo's capture date;
/// a manual value or a clear is left alone.
function ProjectDateField({
  day,
  firstPhotoPath,
  onChange,
}: {
  day: string;
  firstPhotoPath: string | undefined;
  onChange: (day: string) => void;
}) {
  const suggested = useRef(false);
  const capture = useCaptureDate();
  const prefill = async () => {
    if (day !== "" || suggested.current || !firstPhotoPath) return;
    suggested.current = true;
    const result = await capture.mutateAsync(firstPhotoPath);
    if (result.day) onChange(result.day);
  };
  return (
    <div className="space-y-1.5">
      <Label htmlFor="project-day">Date</Label>
      <Input
        id="project-day"
        data-testid="project-day"
        type="date"
        value={day}
        onFocus={prefill}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
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
  const last = useRef(shoot);
  if (shoot) last.current = shoot;
  const shown = open ? shoot : last.current;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {shown ? (
          <ShootSettingsForm
            shoot={shown}
            onCancel={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        ) : (
          <DialogHeader>
            <DialogTitle className="font-heading">Project settings</DialogTitle>
            <DialogDescription>
              This project is no longer in the library.
            </DialogDescription>
          </DialogHeader>
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
  const [draft, setDraft] = useState<ProjectDraft>({
    name: shoot.name,
    notes: shoot.notes,
  });
  const [day, setDay] = useState(shoot.day ?? "");
  const [cover, setCover] = useState(shoot.cover);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate(
          {
            shoot: shoot.name,
            name: draft.name.trim(),
            day: day || null,
            notes: draft.notes,
            cover,
          },
          { onSuccess: (result) => onSaved(result.shoot) },
        );
      }}
    >
      <DialogHeader>
        <DialogTitle className="font-heading">Project settings</DialogTitle>
        <DialogDescription>
          The name renames the folder; the rest is metadata.
        </DialogDescription>
      </DialogHeader>

      <ProjectFields
        draft={draft}
        onChange={setDraft}
        dateSlot={
          <ProjectDateField
            day={day}
            firstPhotoPath={images.data?.[0]?.path}
            onChange={setDay}
          />
        }
      />

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>Cover</Label>
          {cover && (
            <Button
              type="button"
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

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          data-testid="save-shoot-settings"
          disabled={!draft.name.trim() || update.isPending}
        >
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
