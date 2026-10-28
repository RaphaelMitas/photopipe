import { Button } from "@photopipe/ui/components/button";
import {
  ClipboardPaste,
  Copy,
  FolderOpen,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { ShortcutTooltip } from "./ShortcutTooltip";

type Props = {
  count: number;
  canPaste: boolean;
  onCopySettings: () => void;
  onPasteSettings: () => void;
  onExport: () => void;
  onReveal?: () => void;
  onDelete: () => void;
  onClear: () => void;
  busy?: boolean;
};

export function SelectionBar({
  count,
  canPaste,
  onCopySettings,
  onPasteSettings,
  onExport,
  onReveal,
  onDelete,
  onClear,
  busy,
}: Props) {
  if (count === 0) return null;
  return (
    <div
      data-testid="selection-bar"
      className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-1.5"
    >
      <span
        data-testid="selection-count"
        className="font-mono text-xs text-muted-foreground"
      >
        {count} selected
      </span>
      <div className="ml-2 flex items-center gap-1">
        <ShortcutTooltip label="Export selection" action="export.open">
          <Button
            size="sm"
            variant="secondary"
            data-testid="action-export"
            disabled={busy}
            onClick={() => onExport()}
            className="h-7 text-xs"
          >
            <Upload />
            Export…
          </Button>
        </ShortcutTooltip>
        {count === 1 && (
          <ShortcutTooltip label="Copy settings" action="settings.copy">
            <Button
              size="sm"
              variant="ghost"
              data-testid="action-copy-settings"
              onClick={() => onCopySettings()}
              className="h-7 text-xs text-muted-foreground"
            >
              <Copy />
              Copy settings
            </Button>
          </ShortcutTooltip>
        )}
        {canPaste && (
          <ShortcutTooltip label="Paste settings" action="settings.paste">
            <Button
              size="sm"
              variant="ghost"
              data-testid="action-paste-settings"
              onClick={() => onPasteSettings()}
              className="h-7 text-xs text-muted-foreground"
            >
              <ClipboardPaste />
              Paste settings
            </Button>
          </ShortcutTooltip>
        )}
        {onReveal && (
          <Button
            size="sm"
            variant="ghost"
            data-testid="action-reveal"
            onClick={() => onReveal()}
            className="h-7 text-xs text-muted-foreground"
          >
            <FolderOpen />
            Reveal
          </Button>
        )}
        <ShortcutTooltip label="Move to Trash">
          <Button
            size="sm"
            variant="ghost"
            data-testid="action-delete"
            onClick={() => onDelete()}
            className="h-7 text-xs text-muted-foreground hover:text-destructive"
          >
            <Trash2 />
            Delete
          </Button>
        </ShortcutTooltip>
      </div>
      <ShortcutTooltip label="Clear selection" action="select.clear">
        <Button
          size="icon"
          variant="ghost"
          data-testid="action-clear"
          aria-label="Clear selection"
          onClick={() => onClear()}
          className="ml-auto size-7 text-muted-foreground"
        >
          <X />
        </Button>
      </ShortcutTooltip>
    </div>
  );
}
