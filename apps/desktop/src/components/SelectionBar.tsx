import { Button } from "@photopipe/ui/components/button";
import { cn } from "@photopipe/ui/lib/utils";
import { ClipboardPaste, Copy, FolderOpen, Trash2, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { ImageFile } from "@/lib/core";
import { useFeatures } from "@/lib/features";
import type { ActionId } from "@/lib/keymap";
import { ShortcutTooltip } from "./ShortcutTooltip";
import { TrashDialog } from "./TrashDialog";

type Props = {
  selected: ImageFile[];
  canPaste: boolean;
  onCopySettings: () => void;
  onPasteSettings: () => void;
  onReveal?: () => void;
  onDelete: () => void;
  onClear: () => void;
  className?: string;
};

export function SelectionBar({
  selected,
  canPaste,
  onCopySettings,
  onPasteSettings,
  onReveal,
  onDelete,
  onClear,
  className,
}: Props) {
  const { trash } = useFeatures();
  const [confirming, setConfirming] = useState(false);
  const count = selected.length;
  if (count === 0 && !confirming) return null;
  return (
    <div
      data-testid="selection-bar"
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pointer-coarse:gap-y-4",
        className,
      )}
    >
      <span
        data-testid="selection-count"
        className="font-medium text-xs tabular-nums"
      >
        {count} selected
      </span>
      <div className="flex shrink-0 items-center gap-1 pointer-coarse:gap-4">
        {count === 1 && (
          <IconAction
            label="Copy settings"
            action="settings.copy"
            testid="action-copy-settings"
            onClick={onCopySettings}
          >
            <Copy />
          </IconAction>
        )}
        {canPaste && (
          <IconAction
            label="Paste settings"
            action="settings.paste"
            testid="action-paste-settings"
            onClick={onPasteSettings}
          >
            <ClipboardPaste />
          </IconAction>
        )}
        {onReveal && (
          <IconAction
            label="Reveal in Finder"
            testid="action-reveal"
            onClick={onReveal}
          >
            <FolderOpen />
          </IconAction>
        )}
        <IconAction
          label={trash ? "Move to Trash" : "Delete for good"}
          testid="action-delete"
          onClick={() => (trash ? onDelete() : setConfirming(true))}
          className="hover:text-destructive"
        >
          <Trash2 />
        </IconAction>
        <IconAction
          label="Clear selection"
          action="select.clear"
          testid="action-clear"
          onClick={onClear}
        >
          <X />
        </IconAction>
      </div>
      <TrashDialog
        photos={selected}
        noun="photo"
        open={confirming}
        onOpenChange={setConfirming}
        onConfirm={onDelete}
        testId="trash-selection"
      />
    </div>
  );
}

function IconAction({
  label,
  action,
  testid,
  onClick,
  className,
  children,
}: {
  label: string;
  action?: ActionId;
  testid: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ShortcutTooltip label={label} action={action}>
      <Button
        size="icon-sm"
        variant="ghost"
        data-testid={testid}
        aria-label={label}
        onClick={() => onClick()}
        className={cn("size-7 text-muted-foreground", className)}
      >
        {children}
      </Button>
    </ShortcutTooltip>
  );
}
