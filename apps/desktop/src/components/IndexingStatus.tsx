import type { ScanProgress } from "@/lib/queries";

const format = new Intl.NumberFormat();

/// Sits in the header while the core fills in ratings and dimensions behind
/// the already-usable library, and disappears the moment it is done.
export function IndexingStatus({ progress }: { progress: ScanProgress }) {
  if (!progress.scanning) return null;
  const share = progress.found === 0 ? 0 : progress.enriched / progress.found;
  return (
    <div
      data-testid="indexing-status"
      className="flex items-center gap-2 text-[10px] text-muted-foreground"
      title="Reading ratings, edits and dimensions"
    >
      <span className="font-mono">
        Indexing {format.format(progress.enriched)} of{" "}
        {format.format(progress.found)}
      </span>
      <span className="h-0.5 w-16 overflow-hidden rounded-full bg-border">
        <span
          data-testid="indexing-bar"
          className="block h-full bg-primary transition-[width] duration-200"
          style={{ width: `${Math.round(share * 100)}%` }}
        />
      </span>
    </div>
  );
}
