import { ArrowRight, LayoutGrid, Rows3 } from "lucide-react";
import { Button } from "./ui/button";
import { ButtonGroup } from "./ui/button-group";

export type ViewMode = "grid" | "list";

type Props = {
  /// What this page is for, in one line — the orientation Media was missing.
  purpose: string;
  view: ViewMode;
  onView: (view: ViewMode) => void;
  /// The always-visible next step. Disabled-with-reason beats hidden.
  cta: { label: string; disabled?: boolean; onClick: () => void } | null;
};

/// The strip above every browser: purpose on the left, the next step and the
/// view switcher on the right. This is where the flow explains itself —
/// the top bar stays pure navigation.
export function BrowserToolbar({ purpose, view, onView, cta }: Props) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {purpose}
      </p>
      {cta && (
        <Button
          size="sm"
          data-testid="next-step"
          disabled={cta.disabled}
          onClick={cta.onClick}
          className="h-7 shrink-0 text-xs"
        >
          {cta.label}
          <ArrowRight />
        </Button>
      )}
      <ButtonGroup>
        <Button
          size="icon-sm"
          variant={view === "grid" ? "secondary" : "outline"}
          data-testid="view-grid"
          aria-pressed={view === "grid"}
          title="Grid view"
          onClick={() => onView("grid")}
        >
          <LayoutGrid />
        </Button>
        <Button
          size="icon-sm"
          variant={view === "list" ? "secondary" : "outline"}
          data-testid="view-list"
          aria-pressed={view === "list"}
          title="List view"
          onClick={() => onView("list")}
        >
          <Rows3 />
        </Button>
      </ButtonGroup>
    </div>
  );
}
