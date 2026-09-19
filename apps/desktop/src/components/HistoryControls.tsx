import { Button } from "@photopipe/ui/components/button";
import { ButtonGroup } from "@photopipe/ui/components/button-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@photopipe/ui/components/popover";
import { Segmented } from "@photopipe/ui/components/segmented";
import { cn } from "@photopipe/ui/lib/utils";
import {
  FolderOpen,
  History,
  type LucideIcon,
  Redo2,
  Undo2,
} from "lucide-react";
import { useState } from "react";
import { fileName } from "@/lib/core";
import { type HistoryEntry, useHistory } from "@/lib/history";

type Scope = "all" | "photo";

const target = (entry: HistoryEntry) =>
  entry.paths.length === 1
    ? fileName(entry.paths[0])
    : `${entry.paths.length} photos`;

export const historyLabel = (entry: HistoryEntry) =>
  [entry.label, entry.detail].filter(Boolean).join(" ");

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function HistoryRow({
  icon: Icon,
  label,
  detail,
  sub,
  time,
  current,
  undone,
  testid,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  detail?: string;
  sub: string;
  time?: string;
  current: boolean;
  undone: boolean;
  testid: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        data-testid={testid}
        aria-current={current}
        onClick={onClick}
        className={cn(
          "group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent",
          current && "bg-primary/15 hover:bg-primary/15",
          undone && "opacity-40",
        )}
      >
        <span
          className={cn(
            "grid size-6.5 shrink-0 place-items-center rounded-md bg-accent text-muted-foreground",
            current && "bg-primary text-primary-foreground",
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-xs">
            {label}{" "}
            <span className="font-mono font-normal text-muted-foreground">
              {detail}
            </span>
          </span>
          <span className="block truncate font-mono text-[10px] text-muted-foreground">
            {sub}
          </span>
        </span>
        <span
          className={cn(
            "font-mono text-[10px] text-muted-foreground",
            current ? "text-primary" : "group-hover:hidden",
          )}
        >
          {time}
        </span>
        {!current && (
          <span className="hidden text-[10px] text-muted-foreground group-hover:inline">
            {undone ? "Redo to here" : "Back to here"}
          </span>
        )}
      </button>
    </li>
  );
}

export function HistoryControls({
  shoot,
  currentPath,
  open,
  onOpenChange,
  disabled,
  onUndo,
  onRedo,
  onJump,
}: {
  shoot: string;
  currentPath: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onJump: (cursor: number) => void;
}) {
  const { entries, cursor } = useHistory();
  const [scope, setScope] = useState<Scope>("all");
  const undoable = entries[cursor - 1];
  const redoable = entries[cursor];
  const rows = entries
    .map((entry, index) => ({ entry, index }))
    .filter(
      ({ entry }) =>
        scope === "all" ||
        (currentPath !== null && entry.paths.includes(currentPath)),
    )
    .reverse();

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
          <div className="flex items-center gap-2 px-2 pt-1 pb-1.5">
            <span className="font-medium text-sm">History</span>
            <div className="ml-auto w-36">
              <Segmented
                value={scope}
                options={[
                  ["all", "All"],
                  ["photo", "This photo"],
                ]}
                testid="history-scope"
                onChange={setScope}
              />
            </div>
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {rows.map(({ entry, index }) => (
              <HistoryRow
                key={entry.id}
                icon={entry.icon}
                label={entry.label}
                detail={entry.detail}
                sub={target(entry)}
                time={clock(entry.at)}
                current={index === cursor - 1}
                undone={index >= cursor}
                testid={`history-row-${index}`}
                onClick={() => onJump(index + 1)}
              />
            ))}
            {scope === "all" && (
              <HistoryRow
                icon={FolderOpen}
                label={`Opened ${shoot}`}
                sub="before any change"
                current={cursor === 0}
                undone={false}
                testid="history-row-origin"
                onClick={() => onJump(0)}
              />
            )}
          </ul>
          <p className="border-border border-t px-2 pt-2 pb-1 text-[10px] text-muted-foreground">
            This session only · ⌘Z undo · ⇧⌘Z redo
          </p>
        </PopoverContent>
      </Popover>
    </ButtonGroup>
  );
}
