import {
  ClipboardPaste,
  Copy,
  FolderOpen,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "./ui/button";

type Props = {
  count: number;
  canPaste: boolean;
  onCopySettings: () => void;
  onPasteSettings: () => void;
  onExport: () => void;
  onReveal: () => void;
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
        <Button
          size="sm"
          variant="secondary"
          data-testid="action-export"
          disabled={busy}
          onClick={() => onExport()}
          title="Export selection (⌘E)"
          className="h-7 text-xs"
        >
          <Upload />
          Export…
        </Button>
        {count === 1 && (
          <Button
            size="sm"
            variant="ghost"
            data-testid="action-copy-settings"
            onClick={() => onCopySettings()}
            title="Copy settings (⌘⇧C)"
            className="h-7 text-xs text-muted-foreground"
          >
            <Copy />
            Copy settings
          </Button>
        )}
        {canPaste && (
          <Button
            size="sm"
            variant="ghost"
            data-testid="action-paste-settings"
            onClick={() => onPasteSettings()}
            title="Paste settings (⌘⇧V)"
            className="h-7 text-xs text-muted-foreground"
          >
            <ClipboardPaste />
            Paste settings
          </Button>
        )}
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
        <Button
          size="sm"
          variant="ghost"
          data-testid="action-delete"
          onClick={() => onDelete()}
          title="Move to Trash"
          className="h-7 text-xs text-muted-foreground hover:text-destructive"
        >
          <Trash2 />
          Delete
        </Button>
      </div>
      <Button
        size="icon"
        variant="ghost"
        data-testid="action-clear"
        onClick={() => onClear()}
        title="Clear selection (esc)"
        className="ml-auto size-7 text-muted-foreground"
      >
        <X />
      </Button>
    </div>
  );
}
