import { AppWindow, FolderOpen, Trash2, Upload, X } from "lucide-react";
import { Button } from "./ui/button";

type Props = {
  count: number;
  /// Label of the app this page hands off to, if one is remembered.
  appLabel?: string | null;
  onOpenIn: () => void;
  onExport: () => void;
  onReveal: () => void;
  onDelete: () => void;
  onClear: () => void;
  busy?: boolean;
};

/// Actions on the current selection. Appears only when something is selected,
/// so the workspace stays out of the way while you're just looking.
///
/// Every handler is invoked with no arguments on purpose: these props are
/// `() => void`, and passing them straight to onClick would feed the DOM
/// event in as a parameter — which then travels to the core as data.
export function SelectionBar({
  count,
  appLabel,
  onOpenIn,
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
          data-testid="action-open-in"
          disabled={busy}
          onClick={() => onOpenIn()}
          className="h-7 text-xs"
        >
          <AppWindow />
          {appLabel ? `Open in ${appLabel}` : "Open in…"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          data-testid="action-export"
          disabled={busy}
          onClick={() => onExport()}
          className="h-7 text-xs"
        >
          <Upload />
          Export…
        </Button>
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
