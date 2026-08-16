import type { ScanProgress } from "@/lib/queries";
import { ProgressBar } from "./ProgressBar";

const format = new Intl.NumberFormat();

/// Sits in the header while the core fills in ratings and dimensions behind
/// the already-usable library.
export function IndexingStatus({ progress }: { progress: ScanProgress }) {
  if (!progress.scanning) return null;
  const share =
    progress.filesFound === 0
      ? 0
      : progress.filesEnriched / progress.filesFound;
  return (
    <div
      data-testid="indexing-status"
      className="flex items-center gap-2 text-[10px] text-muted-foreground"
      title="Reading ratings, edits and dimensions"
    >
      <span className="font-mono">
        Indexing {format.format(progress.filesEnriched)} of{" "}
        {format.format(progress.filesFound)}
      </span>
      <ProgressBar share={share} testid="indexing-bar" className="w-16" />
    </div>
  );
}
