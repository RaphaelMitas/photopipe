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
import { useEffect, useRef } from "react";
import { fileName } from "@/lib/fileName";
import { type HistoryEntry, historyLabel, useHistory } from "@/lib/history";

const target = (entry: HistoryEntry) =>
  entry.paths.length === 1
    ? fileName(entry.paths[0])
    : `${entry.paths.length} photos`;

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
  const button = useRef<HTMLButtonElement>(null);
  const opening = useRef(true);
  // in the middle when the popover opens, then only kept in view as ⌘Z moves it
  useEffect(() => {
    if (current) {
      button.current?.scrollIntoView({
        block: opening.current ? "center" : "nearest",
      });
    }
    opening.current = false;
  }, [current]);
  const hint = `${undone ? "Redo to here" : "Back to here"} · ${steps} ${
    steps === 1 ? "step" : "steps"
  }`;
  return (
    <Item
      asChild
      size="2xs"
      variant={current ? "muted" : "default"}
      className={cn("text-left hover:bg-muted", undone && "opacity-40")}
    >
      <button
        ref={button}
        type="button"
        data-testid={
          position === 0 ? "history-row-origin" : `history-row-${position - 1}`
        }
        aria-current={current}
        title={current ? undefined : hint}
        onClick={onJump}
      >
        <ItemMedia variant="icon" className={cn(current && "text-primary")}>
          <Icon />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>
            {label}{" "}
            <span className="font-normal text-muted-foreground">{detail}</span>
          </ItemTitle>
          <ItemDescription>{sub}</ItemDescription>
        </ItemContent>
        <ItemActions className="text-muted-foreground text-xs">
          {time}
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
          <ItemGroup className="max-h-96 overflow-y-auto">
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
