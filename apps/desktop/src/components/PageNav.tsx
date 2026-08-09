import type { LucideIcon } from "lucide-react";
import { Film, Images, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

/// The workspaces. Order is a hint about how work usually flows, never a
/// gate — every page is reachable at any time, like Resolve's pages.
export const PAGES = ["media", "edit", "export"] as const;
export type Page = (typeof PAGES)[number];

export const PAGE_META: Record<Page, { label: string; icon: LucideIcon }> = {
  media: { label: "Media", icon: Images },
  edit: { label: "Edit", icon: Film },
  export: { label: "Export", icon: Upload },
};

type Props = {
  page: Page;
  onPage: (page: Page) => void;
  /// Per-page workload, derived from the files: waiting counts for the
  /// stages, ready count for export. The tabs whisper where work piles up
  /// without ever becoming a stepper.
  badges?: Partial<Record<Page, number>>;
};

/// The only thing in the top bar. Anything informational belongs in the
/// sidebar — this strip is navigation and nothing else (the badges are part
/// of naming the destination, like an inbox count).
export function PageNav({ page, onPage, badges }: Props) {
  return (
    <nav
      data-testid="page-nav"
      aria-label="Workspaces"
      className="flex items-center justify-center gap-1"
    >
      {PAGES.map((name, index) => {
        const { label, icon: Icon } = PAGE_META[name];
        const active = page === name;
        const badge = badges?.[name];
        return (
          <button
            key={name}
            type="button"
            data-testid={`page-${name}`}
            data-active={active}
            aria-current={active ? "page" : undefined}
            title={`${label} (⌘${index + 1})`}
            onClick={() => onPage(name)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs transition-colors",
              active
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon className="size-3.5 shrink-0" />
            {label}
            {badge !== undefined && badge > 0 && (
              <span
                data-testid={`badge-${name}`}
                className="rounded-full bg-primary/15 px-1.5 font-mono text-[10px] text-primary"
              >
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
