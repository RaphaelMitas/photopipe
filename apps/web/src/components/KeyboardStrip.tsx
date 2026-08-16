import { Badge } from "@photopipe/ui/components/badge";

const SHORTCUTS = [
  { keys: ["1", "–", "5"], action: "rate" },
  { keys: ["0"], action: "clear" },
  { keys: ["←", "→"], action: "next" },
  { keys: ["↑", "↓"], action: "exposure" },
  { keys: ["e"], action: "edit panel" },
  { keys: ["r"], action: "reset" },
  { keys: ["⌘C", "⌘V"], action: "settings" },
];

export function KeyboardStrip() {
  return (
    <div className="border-border/60 border-y bg-card/30">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-x-6 gap-y-3 px-6 py-8">
        {SHORTCUTS.map((shortcut) => (
          <span key={shortcut.action} className="flex items-center gap-1.5">
            {shortcut.keys.map((key) =>
              key === "–" ? (
                <span key={key} className="text-muted-foreground">
                  –
                </span>
              ) : (
                <Badge key={key} variant="outline" className="font-mono">
                  {key}
                </Badge>
              ),
            )}
            <span className="text-muted-foreground text-sm">
              {shortcut.action}
            </span>
          </span>
        ))}
        <span className="text-muted-foreground/70 text-sm">
          200 frames without leaving the keyboard.
        </span>
      </div>
    </div>
  );
}
