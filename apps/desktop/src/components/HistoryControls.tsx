import { Button } from "@photopipe/ui/components/button";
import { ButtonGroup } from "@photopipe/ui/components/button-group";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@photopipe/ui/components/item";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@photopipe/ui/components/popover";
import { cn } from "@photopipe/ui/lib/utils";
import { FolderOpen, History, Redo2, Undo2 } from "lucide-react";
import { fileName } from "@/lib/fileName";
import { type HistoryEntry, useHistory } from "@/lib/history";

const target = (entry: HistoryEntry) => {
  if (entry.paths.length === 0) return "project";
  return entry.paths.length === 1
    ? fileName(entry.paths[0])
    : `${entry.paths.length} photos`;
};

export const historyLabel = (entry: HistoryEntry) =>
  [entry.label, entry.detail].filter(Boolean).join(" ");

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

type Row = Pick<HistoryEntry, "icon" | "label" | "detail"> & {
  sub: string;
  time?: string;
};

// position counts the entries applied once you are on this row; the origin is 0
function HistoryRow({
  row: { icon: Icon, label, detail, sub, time },
  position,
  cursor,
  onJump,
}: {
  row: Row;
  position: number;
  cursor: number;
  onJump: () => void;
}) {
  const steps = Math.abs(cursor - position);
  const undone = position > cursor;
  const current = steps === 0;
  return (
    <Item
      asChild
      size="xs"
      className={cn(
        "gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent",
        current && "bg-primary/15 hover:bg-primary/15",
        undone && "opacity-40",
      )}
    >
      <button
        type="button"
        data-testid={
          position === 0 ? "history-row-origin" : `history-row-${position - 1}`
        }
        aria-current={current}
        onClick={onJump}
      >
        <ItemMedia
          variant="icon"
          className={cn(
            "size-6.5 translate-y-0! self-center! rounded-md bg-accent text-muted-foreground [&_svg]:size-3.5!",
            current && "bg-primary text-primary-foreground",
          )}
        >
          <Icon />
        </ItemMedia>
        <ItemContent className="min-w-0 gap-0!">
          <ItemTitle className="text-xs">
            {label}{" "}
            <span className="font-mono font-normal text-muted-foreground">
              {detail}
            </span>
          </ItemTitle>
          <ItemDescription className="line-clamp-1 font-mono text-[10px]">
            {sub}
          </ItemDescription>
        </ItemContent>
        <ItemActions className="text-[10px] text-muted-foreground">
          <span
            className={cn(
              "font-mono",
              current ? "text-primary" : "group-hover/item:hidden",
            )}
          >
            {time}
          </span>
          {!current && (
            <span className="hidden group-hover/item:inline">
              {undone ? "Redo to here" : "Back to here"}
              {steps > 1 && ` · ${steps} steps`}
            </span>
          )}
        </ItemActions>
      </button>
    </Item>
  );
}

export function HistoryControls({
  shoot,
  open,
  onOpenChange,
  disabled,
  onUndo,
  onRedo,
  onJump,
}: {
  shoot: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onJump: (cursor: number, entry?: HistoryEntry) => void;
}) {
  const { entries, cursor } = useHistory();
  const undoable = entries[cursor - 1];
  const redoable = entries[cursor];
  return (
    <ButtonGroup>
      <Button
        size="icon-sm"
        variant="secondary"
        data-testid="history-undo"
        onClick={onUndo}
        disabled={disabled || !undoable}
        title={
          undoable ? `Undo ${historyLabel(undoable)} (⌘Z)` : "Nothing to undo"
        }
        className="size-7"
      >
        <Undo2 />
      </Button>
      <Button
        size="icon-sm"
        variant="secondary"
        data-testid="history-redo"
        onClick={onRedo}
        disabled={disabled || !redoable}
        title={
          redoable ? `Redo ${historyLabel(redoable)} (⇧⌘Z)` : "Nothing to redo"
        }
        className="size-7"
      >
        <Redo2 />
      </Button>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <Button
            size="icon-sm"
            variant="secondary"
            data-testid="history-toggle"
            disabled={disabled}
            title="Show history (⌘Y)"
            className={cn("size-7", open && "text-primary")}
          >
            <History />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          data-testid="history-popover"
          className="w-80 gap-1 rounded-2xl p-1.5"
        >
          <span className="px-2 pt-1 pb-1.5 font-medium text-sm">History</span>
          <ItemGroup className="max-h-96 gap-0! overflow-y-auto">
            {entries
              .map((entry, index) => (
                <HistoryRow
                  key={entry.id}
                  row={{ ...entry, sub: target(entry), time: clock(entry.at) }}
                  position={index + 1}
                  cursor={cursor}
                  onJump={() => onJump(index + 1, entry)}
                />
              ))
              .reverse()}
            <HistoryRow
              row={{
                icon: FolderOpen,
                label: `Opened ${shoot}`,
                sub: "before any change",
              }}
              position={0}
              cursor={cursor}
              onJump={() => onJump(0)}
            />
          </ItemGroup>
          <p className="border-border border-t px-2 pt-2 pb-1 text-[10px] text-muted-foreground">
            This session only · ⌘Z undo · ⇧⌘Z redo
          </p>
        </PopoverContent>
      </Popover>
    </ButtonGroup>
  );
}
