import { Button } from "@photopipe/ui/components/button";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import type { ImageFile } from "@/lib/core";
import { useFeatures } from "@/lib/features";
import { pluralize } from "@/lib/plural";
import { ShortcutTooltip } from "./ShortcutTooltip";
import { TrashDialog } from "./TrashDialog";

export function TrashRejects({
  rejects,
  onConfirm,
}: {
  rejects: ImageFile[];
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { trash } = useFeatures();
  if (rejects.length === 0 && !open) return null;
  const count = pluralize(rejects.length, "reject");
  return (
    <>
      <ShortcutTooltip
        label={
          trash
            ? "Move every rejected photo in this project to the Trash"
            : "Delete every rejected photo in this project"
        }
      >
        <Button
          size="sm"
          variant="ghost"
          data-testid="trash-rejects"
          onClick={() => setOpen(true)}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 />
          {trash ? "Trash" : "Delete"} {count}…
        </Button>
      </ShortcutTooltip>
      <TrashDialog
        photos={rejects}
        noun="rejected photo"
        open={open}
        onOpenChange={setOpen}
        onConfirm={onConfirm}
        testId="trash-rejects"
      />
    </>
  );
}
