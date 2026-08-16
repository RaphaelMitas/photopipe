import { Button } from "@photopipe/ui/components/button";
import { ButtonGroup } from "@photopipe/ui/components/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@photopipe/ui/components/dropdown-menu";
import { ArrowUpDown, LayoutGrid, Rows3, Sparkles } from "lucide-react";
import type { ScoreProgress } from "@/lib/queries";
import type { SortKey } from "@/lib/sort";

export type ViewMode = "grid" | "list";

const SORT_LABELS: Record<SortKey, string> = {
  name: "Name",
  date: "Date",
  score: "Instinct",
};

type Props = {
  purpose: string;
  view: ViewMode;
  onView: (view: ViewMode) => void;
  sort: SortKey;
  onSort: (sort: SortKey) => void;
  scoreReady: boolean;
  scoring: ScoreProgress | null;
  justRated: boolean;
};

export function BrowserToolbar({
  purpose,
  view,
  onView,
  sort,
  onSort,
  scoreReady,
  scoring,
  justRated,
}: Props) {
  const rating = scoring?.running === true;
  const done = rating && scoring.total > 0 ? scoring.done / scoring.total : 0;

  return (
    <div className="relative flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {rating ? (
          <span className="flex items-center gap-1.5" data-testid="rating-now">
            <Sparkles className="size-3.5 text-primary" />
            Instinct is rating · {scoring.done.toLocaleString()} of{" "}
            {scoring.total.toLocaleString()}
          </span>
        ) : (
          purpose
        )}
      </p>
      {justRated && sort !== "score" && (
        <Button
          size="sm"
          variant="outline"
          data-testid="rated-offer"
          onClick={() => onSort("score")}
        >
          <Sparkles className="text-primary" />
          Rated · Sort by Instinct
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" data-testid="sort">
            <ArrowUpDown className="text-muted-foreground" />
            <span className="text-muted-foreground">Sorted by</span>
            {SORT_LABELS[sort]}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup
            value={sort}
            onValueChange={(value) => onSort(value as SortKey)}
          >
            <DropdownMenuRadioItem value="name">
              {SORT_LABELS.name}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="date">
              {SORT_LABELS.date}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem
              value="score"
              disabled={!scoreReady}
              data-testid="sort-score"
            >
              {SORT_LABELS.score}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
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
      {rating && (
        <div
          className="-bottom-px absolute inset-x-0 h-0.5 bg-foreground/10"
          data-testid="rating-progress"
        >
          <div
            className="h-full bg-primary transition-[width] duration-500"
            style={{ width: `${done * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}
