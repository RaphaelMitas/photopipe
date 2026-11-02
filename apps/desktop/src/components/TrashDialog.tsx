import { Button } from "@photopipe/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@photopipe/ui/components/dialog";
import type { ImageFile } from "@/lib/core";
import { useFeatures } from "@/lib/features";
import { pluralize } from "@/lib/plural";
import { useTrashBlocked } from "@/lib/queries";
import { Thumbnail } from "./Thumbnail";

const PREVIEWS = 6;

export function TrashDialog({
  photos,
  noun,
  open,
  onOpenChange,
  onConfirm,
  testId,
}: {
  photos: ImageFile[];
  noun: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  testId: string;
}) {
  const { trash } = useFeatures();
  const blocked = useTrashBlocked();
  const count = pluralize(photos.length, noun);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid={`${testId}-dialog`}>
        <DialogHeader>
          <DialogTitle className="font-heading">
            {trash ? `Move ${count} to the Trash?` : `Delete ${count}?`}
          </DialogTitle>
          <DialogDescription>
            Their sidecars go with them.{" "}
            {trash
              ? "Undo can't bring them back; Finder's Put Back can."
              : "This can't be undone."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-1">
          {photos.slice(0, PREVIEWS).map((image) => (
            <Thumbnail
              key={image.path}
              file={image}
              className="h-10 w-14 rounded-sm"
            />
          ))}
          {photos.length > PREVIEWS && (
            <span className="pl-1 font-mono text-muted-foreground text-xs">
              +{photos.length - PREVIEWS}
            </span>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" autoFocus onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            data-testid={`${testId}-confirm`}
            disabled={photos.length === 0 || blocked}
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {blocked
              ? "Saving…"
              : trash
                ? `Move ${photos.length} to Trash`
                : `Delete ${photos.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
