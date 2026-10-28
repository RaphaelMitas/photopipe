import { Button } from "@photopipe/ui/components/button";
import { Input } from "@photopipe/ui/components/input";
import { Kbd } from "@photopipe/ui/components/kbd";
import { Label } from "@photopipe/ui/components/label";
import { Segmented } from "@photopipe/ui/components/segmented";
import { Switch } from "@photopipe/ui/components/switch";
import { cn } from "@photopipe/ui/lib/utils";
import { Lock, Plus, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import {
  ACTION_IDS,
  ACTIONS,
  type ActionId,
  type Context,
  chordsOf,
  formatChord,
  GROUPS,
  RESERVED,
} from "@/lib/keymap";
import {
  assignShortcut,
  bindingsOf,
  conflictOf,
  isChanged,
  resetAllShortcuts,
  resetShortcut,
  unbindShortcut,
  useOverrides,
} from "@/lib/shortcuts";
import { tooltipsPref } from "./ShortcutTooltip";

type Recording = { id: ActionId; replacing: string | null };
type Conflict = Recording & { chord: string; other: ActionId };
type Show = "all" | Context | "changed";

const SHOW: readonly [Show, string][] = [
  ["all", "All"],
  ["browser", "Browser"],
  ["loupe", "Loupe"],
  ["crop", "Crop"],
  ["changed", "Changed"],
];

const RESERVED_KEYS = [...RESERVED].map(formatChord).join(" ");

export function KeyboardSettings() {
  const overrides = useOverrides();
  const tooltips = tooltipsPref.use();
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [recording, setRecording] = useState<Recording | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);

  // Captured ahead of the dialog, so Escape cancels the recording instead of closing Settings.
  useEffect(() => {
    if (!recording) return;
    const capture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(null);
        return;
      }
      if (event.key === "Backspace") {
        if (recording.replacing) {
          unbindShortcut(recording.id, recording.replacing);
        }
        setRecording(null);
        return;
      }
      const [chord] = chordsOf(event);
      if (!chord) return;
      if (RESERVED.has(chord)) {
        setRefused(`${formatChord(chord)} belongs to macOS`);
        return;
      }
      setRecording(null);
      const other = conflictOf(recording.id, chord);
      if (other) setConflict({ ...recording, chord, other });
      else assignShortcut(recording.id, recording.replacing, chord);
    };
    window.addEventListener("keydown", capture, true);
    return () => window.removeEventListener("keydown", capture, true);
  }, [recording]);

  const record = (id: ActionId, replacing: string | null) => {
    setConflict(null);
    setRefused(null);
    setRecording({ id, replacing });
  };

  const needle = query.trim().toLowerCase();
  const visible = ACTION_IDS.filter((id) => {
    const action = ACTIONS[id];
    if (show === "changed" && !isChanged(id, overrides)) return false;
    if (show !== "all" && show !== "changed" && !action.contexts.includes(show))
      return false;
    return (
      action.label.toLowerCase().includes(needle) ||
      bindingsOf(id, overrides).some((chord) =>
        formatChord(chord).toLowerCase().includes(needle),
      )
    );
  });
  const changedCount = ACTION_IDS.filter((id) =>
    isChanged(id, overrides),
  ).length;

  const recordingChip = (
    <span className="inline-flex h-5.5 items-center rounded-lg border border-primary border-dashed px-2 text-primary text-xs">
      {refused ?? "Press keys… esc cancels, ⌫ unbinds"}
    </span>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-start justify-between gap-6">
        <div className="flex flex-col gap-1">
          <Label htmlFor="shortcut-tooltips">Show tooltips</Label>
          <p className="text-muted-foreground text-xs">
            Hovering a button names it and shows its key.
          </p>
        </div>
        <Switch
          id="shortcut-tooltips"
          data-testid="shortcut-tooltips"
          checked={tooltips}
          onCheckedChange={tooltipsPref.set}
        />
      </div>
      <div className="flex items-center gap-2">
        <Input
          data-testid="shortcut-search"
          placeholder="Search actions or keys…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-8 flex-1"
        />
        <div className="w-72">
          <Segmented
            value={show}
            options={SHOW.map(([value, label]) =>
              value === "changed" && changedCount > 0
                ? [value, `${label} · ${changedCount}`]
                : [value, label],
            )}
            testid="shortcut-show"
            onChange={setShow}
          />
        </div>
      </div>
      <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2">
        {GROUPS.map((group) => {
          const rows = visible.filter((id) => ACTIONS[id].group === group);
          if (rows.length === 0) return null;
          return (
            <section key={group}>
              <h3 className="px-2 pt-3 pb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                {group}
              </h3>
              {rows.map((id) => {
                const action = ACTIONS[id];
                const changed = isChanged(id, overrides);
                const recordingHere = recording?.id === id;
                return (
                  <div key={id} data-testid={`shortcut-${id}`}>
                    <div
                      className={cn(
                        "group/row flex min-h-8 items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-accent/50",
                        recordingHere && "bg-primary/10",
                      )}
                    >
                      <span className="flex-1 text-sm">
                        {action.label}
                        {changed && (
                          <span className="ml-1.5 text-primary">•</span>
                        )}
                      </span>
                      {bindingsOf(id, overrides).map((chord) =>
                        recordingHere && recording.replacing === chord ? (
                          <span key={chord}>{recordingChip}</span>
                        ) : (
                          <button
                            key={chord}
                            type="button"
                            disabled={action.fixed}
                            aria-label={`Change ${formatChord(chord)} for ${action.label}`}
                            onClick={() => record(id, chord)}
                          >
                            <Kbd>{formatChord(chord)}</Kbd>
                          </button>
                        ),
                      )}
                      {recordingHere && recording.replacing === null && (
                        <span>{recordingChip}</span>
                      )}
                      {action.fixed ? (
                        <Lock
                          aria-label="Owned by macOS"
                          className="mx-1.5 size-3 text-muted-foreground"
                        />
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Add a key for ${action.label}`}
                            onClick={() => record(id, null)}
                            className="size-6 text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100"
                          >
                            <Plus className="size-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Reset ${action.label}`}
                            onClick={() => resetShortcut(id)}
                            className={cn(
                              "size-6 text-muted-foreground",
                              !changed && "invisible",
                            )}
                          >
                            <RotateCcw className="size-3" />
                          </Button>
                        </>
                      )}
                    </div>
                    {conflict?.id === id && (
                      <div
                        data-testid="shortcut-conflict"
                        className="my-1 flex items-center gap-2 rounded-lg bg-card px-3 py-2 text-xs"
                      >
                        <span className="flex-1">
                          <Kbd>{formatChord(conflict.chord)}</Kbd> is already{" "}
                          <b>{ACTIONS[conflict.other].label}</b>.
                        </span>
                        <Button
                          size="sm"
                          variant="secondary"
                          data-testid="shortcut-conflict-take"
                          onClick={() => {
                            assignShortcut(
                              conflict.id,
                              conflict.replacing,
                              conflict.chord,
                            );
                            setConflict(null);
                          }}
                          className="h-7 text-xs"
                        >
                          {conflict.replacing ? "Swap" : "Take it"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConflict(null)}
                          className="h-7 text-xs"
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
      <div className="flex items-center gap-3 border-border border-t pt-3">
        <span className="flex-1 text-[11px] text-muted-foreground">
          {RESERVED_KEYS} belong to macOS and can't be changed
        </span>
        <Button
          variant="outline"
          size="sm"
          data-testid="shortcut-reset-all"
          disabled={changedCount === 0}
          onClick={() => {
            setRecording(null);
            setConflict(null);
            resetAllShortcuts();
          }}
        >
          Reset all to defaults
        </Button>
      </div>
    </div>
  );
}
