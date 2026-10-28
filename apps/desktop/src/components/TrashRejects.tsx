import { Button } from "@photopipe/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@photopipe/ui/components/dialog";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import type { ImageFile } from "@/lib/core";
import { pluralize } from "@/lib/plural";
import { useTrashBlocked } from "@/lib/queries";
import { ShortcutTooltip } from "./ShortcutTooltip";
import { Thumbnail } from "./Thumbnail";

const PREVIEWS = 6;

export function TrashRejects({
  rejects,
  onConfirm,
}: {
  rejects: ImageFile[];
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const blocked = useTrashBlocked();
  if (rejects.length === 0 && !open) return null;
  const count = pluralize(rejects.length, "rejected photo");
  return (
    <>
      <ShortcutTooltip label="Move every rejected photo in this project to the Trash">
        <Button
          size="sm"
          variant="ghost"
          data-testid="trash-rejects"
          onClick={() => setOpen(true)}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 />
          Trash {pluralize(rejects.length, "reject")}…
        </Button>
      </ShortcutTooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="trash-rejects-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">
              Move {count} to the Trash?
            </DialogTitle>
            <DialogDescription>
              Their sidecars go with them. Undo can't bring them back; Finder's
              Put Back can.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-1">
            {rejects.slice(0, PREVIEWS).map((image) => (
              <Thumbnail
                key={image.path}
                file={image}
                className="h-10 w-14 rounded-sm"
              />
            ))}
            {rejects.length > PREVIEWS && (
              <span className="pl-1 font-mono text-muted-foreground text-xs">
                +{rejects.length - PREVIEWS}
              </span>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" autoFocus onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              data-testid="trash-rejects-confirm"
              disabled={rejects.length === 0 || blocked}
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              {blocked ? "Saving…" : `Move ${rejects.length} to Trash`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
