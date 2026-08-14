import { LayoutGrid, Rows3 } from "lucide-react";
import { Button } from "./ui/button";
import { ButtonGroup } from "./ui/button-group";

export type ViewMode = "grid" | "list";

type Props = {
  purpose: string;
  view: ViewMode;
  onView: (view: ViewMode) => void;
};

export function BrowserToolbar({ purpose, view, onView }: Props) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {purpose}
      </p>
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
