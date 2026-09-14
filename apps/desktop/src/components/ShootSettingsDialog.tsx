import { Button } from "@photopipe/ui/components/button";
import { Calendar } from "@photopipe/ui/components/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@photopipe/ui/components/dialog";
import { Label } from "@photopipe/ui/components/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@photopipe/ui/components/popover";
import { Skeleton } from "@photopipe/ui/components/skeleton";
import { cn } from "@photopipe/ui/lib/utils";
import { CalendarIcon, Check } from "lucide-react";
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import { type ProjectDraft, ProjectFields } from "@/components/ProjectFields";
import { fileSrc, type ImageFile, type Shoot } from "@/lib/core";
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

const fromDay = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const toDay = (date: Date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

function ProjectDateField({
  day,
  firstPhotoPath,
  onChange,
}: {
  day: string;
  firstPhotoPath: string | undefined;
  onChange: Dispatch<SetStateAction<string>>;
}) {
  const [open, setOpen] = useState(false);
  // suggest once, and only for a project that opened undated; a clear stays cleared
  const suggested = useRef(day !== "");
  const { mutate: suggest } = useCaptureDate();
  const selected = day ? fromDay(day) : undefined;
  useEffect(() => {
    if (!open || suggested.current || !firstPhotoPath) return;
    suggested.current = true;
    suggest(firstPhotoPath, {
      onSuccess: ({ day }) => day && onChange((current) => current || day),
    });
  }, [open, firstPhotoPath, suggest, onChange]);
  return (
    <div className="space-y-1.5">
      <Label htmlFor="project-day">Date</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id="project-day"
            type="button"
            variant="outline"
            data-testid="project-day"
            data-day={day}
            className="w-44 justify-start font-normal"
          >
            <CalendarIcon className="text-muted-foreground" />
            {selected ? (
              selected.toLocaleDateString(undefined, { dateStyle: "medium" })
            ) : (
              <span className="text-muted-foreground">Pick a date</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            key={day}
            mode="single"
            selected={selected}
            defaultMonth={selected}
            onSelect={(date) => {
              onChange(date ? toDay(date) : "");
              setOpen(false);
            }}
          />
          {day && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="project-day-clear"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className="mx-3 mb-3 text-muted-foreground"
            >
              Clear
            </Button>
          )}
        </PopoverContent>
      </Popover>
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
