import { Button } from "@photopipe/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@photopipe/ui/components/dropdown-menu";
import { cn } from "@photopipe/ui/lib/utils";
import {
  ArrowUpDown,
  LayoutGrid,
  type LucideIcon,
  Rows3,
  Sparkles,
} from "lucide-react";
import type { ReactNode } from "react";
import type { PassProgress } from "@/lib/core";
import { pref } from "@/lib/pref";
import { isSortKey, SORT_KEYS, SORT_LABELS, type SortKey } from "@/lib/sort";
import { ShortcutTooltip } from "./ShortcutTooltip";

export type ViewMode = "grid" | "list";

export const viewPref = pref(
  "photopipe.view",
  (raw): ViewMode => (raw === "list" ? "list" : "grid"),
  String,
);

const VIEWS = [
  ["grid", LayoutGrid, "Grid view"],
  ["list", Rows3, "List view"],
] as const satisfies readonly [ViewMode, LucideIcon, string][];

type Props = {
  selection?: ReactNode;
  view: ViewMode;
  onView: (view: ViewMode) => void;
  sort: SortKey;
  onSort: (sort: SortKey) => void;
  sortReady: Record<SortKey, boolean>;
  scoring: PassProgress | null;
  justRated: boolean;
  children?: ReactNode;
};

export function BrowserToolbar({
  selection,
  view,
  onView,
  sort,
  onSort,
  sortReady,
  scoring,
  justRated,
  children,
}: Props) {
  const rating = scoring?.running === true;
  const done = rating && scoring.total > 0 ? scoring.done / scoring.total : 0;

  return (
    <div className="@container relative flex min-h-11 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 pointer-coarse:gap-y-4 border-b border-border px-3 py-1.5">
      {selection}
      {rating && (
        <p className="min-w-40 flex-1 truncate text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5" data-testid="rating-now">
            <Sparkles className="size-3.5 shrink-0 text-primary" />
            Instinct is rating · {scoring.done.toLocaleString()} of{" "}
            {scoring.total.toLocaleString()}
          </span>
        </p>
      )}
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 pointer-coarse:gap-y-4">
        {justRated && sort !== "score" && (
          <Button
            size="sm"
            variant="outline"
            data-testid="rated-offer"
            onClick={() => onSort("score")}
            className="h-7 text-xs"
          >
            <Sparkles className="text-primary" />
            Rated · Sort by Instinct
          </Button>
        )}
        {children}
        <div className="flex shrink-0 items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                data-testid="sort"
                className="h-7 text-xs"
              >
                <ArrowUpDown className="text-muted-foreground" />
                <span className="text-muted-foreground @max-lg:hidden">
                  Sorted by
                </span>
                {SORT_LABELS[sort]}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={sort}
                onValueChange={(value) => {
                  if (isSortKey(value)) onSort(value);
                }}
              >
                {SORT_KEYS.map((key) => (
                  <DropdownMenuRadioItem
                    key={key}
                    value={key}
                    disabled={!sortReady[key]}
                    data-testid={`sort-${key}`}
                  >
                    {SORT_LABELS[key]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="flex gap-1 pointer-coarse:gap-4">
            {VIEWS.map(([mode, Icon, label]) => (
              <ShortcutTooltip key={mode} label={label}>
                <Button
                  aria-label={label}
                  size="icon-sm"
                  variant={view === mode ? "secondary" : "ghost"}
                  data-testid={`view-${mode}`}
                  aria-pressed={view === mode}
                  onClick={() => onView(mode)}
                  className={cn(
                    "size-7",
                    view !== mode && "text-muted-foreground",
                  )}
                >
                  <Icon />
                </Button>
              </ShortcutTooltip>
            ))}
          </div>
        </div>
      </div>
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
