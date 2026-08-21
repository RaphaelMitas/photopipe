import { Button } from "@photopipe/ui/components/button";
import { Progress } from "@photopipe/ui/components/progress";
import { Segmented } from "@photopipe/ui/components/segmented";
import { Switch } from "@photopipe/ui/components/switch";
import { cn } from "@photopipe/ui/lib/utils";
import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import {
  AlertCircle,
  Check,
  FolderOpen,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { useState } from "react";
import type { ExportFormat } from "@/lib/core";
import {
  type ExportJob,
  type JobStatus,
  jobStatus,
  useDecoderSupport,
} from "@/lib/queries";
import { type RawDecoderVersion, rawDecoderVersion } from "@/lib/rawDecoder";

export type ExportOptions = {
  format: ExportFormat;
  quality: number;
  zip: boolean;
  flatten: boolean;
  decoderVersion: RawDecoderVersion;
};

export function exportLabel(count: number, format: ExportFormat): string {
  return `Export ${count} ${format === "jpeg" ? "as JPEG" : "originals"}`;
}

type Props = {
  shoot: string;
  rawPaths: string[];
  selectedCount: number;
  editedCount: number;
  filteredCount: number;
  totalCount: number;
  filterActive: boolean;
  jobs: ExportJob[];
  busy: boolean;
  onSelectFiltered: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onExport: (options: ExportOptions, destination: string) => void;
  onCancel: (id: string) => void;
  onReveal: (path: string) => void;
  onClose: () => void;
};

/// Held back until a few files are in: the first render of a shoot pays for a
/// cold cache and would promise a number nothing else lives up to.
function timeLeft(job: ExportJob, settled: number): string {
  const elapsed = Date.now() - job.startedAt;
  if (settled < 3 || elapsed < 2000) return "";
  const remaining = ((job.total - settled) * elapsed) / settled / 1000;
  if (remaining < 60) return " · under a minute left";
  return ` · about ${Math.round(remaining / 60)} min left`;
}

function jobDetail(job: ExportJob, status: JobStatus, settled: number): string {
  const files = `${job.done} ${job.done === 1 ? "file" : "files"}`;
  switch (status) {
    case "running":
      if (job.archiving) return `${files} · building the archive`;
      // Settled, not delivered: a count that skipped the failures would sit
      // still while the bar and the estimate kept moving.
      return `${settled} of ${job.total}${
        job.failed > 0 ? ` · ${job.failed} failed` : ""
      }${timeLeft(job, settled)}`;
    case "failed":
      return job.error ?? `${job.failed} failed`;
    case "partial":
      return `${files} · ${job.failed} of ${job.total} failed`;
    case "cancelled":
      return `Cancelled · ${files}`;
    case "done":
      return `${files} · ${job.destination}`;
  }
}

function Section({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-border px-3 py-2.5">
      {label && (
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
      )}
      {children}
    </div>
  );
}

const OPTIONS_KEY = "photopipe.export";

function readOptions(): ExportOptions {
  try {
    const stored = localStorage.getItem(OPTIONS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<ExportOptions>;
      return {
        format: parsed.format === "jpeg" ? "jpeg" : "original",
        quality: parsed.quality === 100 ? 100 : 90,
        zip: parsed.zip ?? false,
        flatten: parsed.flatten ?? true,
        decoderVersion: rawDecoderVersion(),
      };
    }
  } catch {
    // Corrupt preferences never block an export.
  }
  return {
    format: "jpeg",
    quality: 90,
    zip: false,
    flatten: true,
    decoderVersion: rawDecoderVersion(),
  };
}

export function ExportDrawer({
  shoot,
  rawPaths,
  selectedCount,
  editedCount,
  filteredCount,
  totalCount,
  filterActive,
  jobs,
  busy,
  onSelectFiltered,
  onSelectAll,
  onClearSelection,
  onExport,
  onCancel,
  onReveal,
  onClose,
}: Props) {
  const [options, setOptions] = useState<ExportOptions>(readOptions);
  const [keepRaw8, setKeepRaw8] = useState(false);
  const support = useDecoderSupport(rawPaths, options.format === "jpeg").data;
  // With nothing to apply RAW 9 to, the row shows the truth, not the wish.
  const decoder: RawDecoderVersion =
    support?.raw9 === 0 ? 8 : options.decoderVersion;
  const someSupport =
    support !== undefined &&
    support.raw9 > 0 &&
    support.raw9 < support.rawTotal;
  const showDecoder = options.format === "jpeg" && rawPaths.length > 0;
  const showBanner =
    showDecoder && decoder === 8 && (support?.raw9 ?? 0) > 0 && !keepRaw8;

  const decoderHelp = (): string => {
    if (support?.raw9 === 0)
      return "RAW 9 isn't available for these photos on this Mac.";
    if (decoder === 8)
      return someSupport && support
        ? `RAW 9 resolves more detail, and applies to ${support.raw9} of ${support.rawTotal} photos.`
        : "RAW 9 resolves more detail and denoises harder.";
    return someSupport && support
      ? `Best detail and denoising, on the ${support.raw9} of ${support.rawTotal} photos that support it.`
      : "Best detail and strongest denoising. Slower to decode.";
  };

  const patch = (next: Partial<ExportOptions>) => {
    setOptions((current) => {
      const merged = { ...current, ...next };
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(merged));
      return merged;
    });
  };

  const pickDestination = async (): Promise<string | null> => {
    if (options.zip) {
      const chosen = await save({
        title: "Save zip",
        defaultPath: `${shoot}.zip`,
        filters: [{ name: "Zip archive", extensions: ["zip"] }],
      }).catch(() => null);
      return typeof chosen === "string" ? chosen : null;
    }
    const chosen = await openDialog({
      title: "Export to folder",
      directory: true,
    }).catch(() => null);
    return typeof chosen === "string" ? chosen : null;
  };

  const runExport = async () => {
    const destination = await pickDestination();
    if (destination)
      onExport({ ...options, decoderVersion: decoder }, destination);
  };

  return (
    <div
      data-testid="export-drawer"
      className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-border bg-sidebar"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="font-medium text-sm">Export</span>
        <Button
          size="icon"
          variant="ghost"
          data-testid="drawer-close"
          onClick={() => onClose()}
          title="Close"
          className="ml-auto size-6 text-muted-foreground"
        >
          <X />
        </Button>
      </div>

      <Section>
        <div className="flex items-baseline gap-1.5">
          <span data-testid="drawer-count" className="font-semibold text-lg">
            {selectedCount}
          </span>
          <span className="text-muted-foreground text-xs">
            selected{editedCount > 0 && ` · ${editedCount} edited`}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {filterActive && (
            <Button
              size="sm"
              variant="outline"
              data-testid="select-filtered"
              onClick={() => onSelectFiltered()}
              className="h-6 text-xs"
            >
              Select filtered · {filteredCount}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            data-testid="select-all"
            onClick={() => onSelectAll()}
            className="h-6 text-xs text-muted-foreground"
          >
            All · {totalCount}
          </Button>
          {selectedCount > 0 && (
            <Button
              size="sm"
              variant="ghost"
              data-testid="drawer-clear"
              onClick={() => onClearSelection()}
              className="h-6 text-xs text-muted-foreground"
            >
              Clear
            </Button>
          )}
        </div>
        {selectedCount === 0 && (
          <p className="text-[10px] text-muted-foreground">
            Pick photos in the grid, or start from a quick action. ⌘-click
            fine-tunes afterwards.
          </p>
        )}
      </Section>

      <Section label="Format">
        <Segmented
          value={options.format}
          options={[
            ["original", "Original"],
            ["jpeg", "JPEG"],
          ]}
          testid="format"
          onChange={(format) => patch({ format })}
        />
        {options.format === "jpeg" ? (
          <div className="flex items-center gap-2">
            <span className="flex-1 text-muted-foreground text-xs">
              Quality
            </span>
            <Segmented
              value={String(options.quality) as "90" | "100"}
              options={[
                ["90", "90"],
                ["100", "100"],
              ]}
              testid="quality"
              onChange={(quality) => patch({ quality: Number(quality) })}
            />
          </div>
        ) : null}
        <p className="text-[10px] text-muted-foreground">
          {options.format === "jpeg"
            ? "Renders every photo full-resolution with its edits baked in."
            : "Copies the files untouched; edits are ignored."}
        </p>
        {showDecoder && (
          <>
            <div className="flex items-center gap-2">
              <span className="flex-1 text-muted-foreground text-xs">
                Decoder
              </span>
              <Segmented
                value={String(decoder) as "8" | "9"}
                options={[
                  ["8", "RAW 8"],
                  ["9", "RAW 9"],
                ]}
                testid="export-decoder"
                disabled={support?.raw9 === 0 ? ["9"] : undefined}
                onChange={(next) => {
                  setKeepRaw8(false);
                  patch({ decoderVersion: next === "8" ? 8 : 9 });
                }}
              />
            </div>
            <p
              data-testid="export-decoder-help"
              className="text-[10px] text-muted-foreground"
            >
              {decoderHelp()}
            </p>
          </>
        )}
      </Section>

      <Section label="Destination">
        <Segmented
          value={options.zip ? "zip" : "folder"}
          options={[
            ["folder", "Folder"],
            ["zip", "Zip"],
          ]}
          testid="dest"
          onChange={(dest) => patch({ zip: dest === "zip" })}
        />
        <div className="flex items-center justify-between gap-2 text-muted-foreground text-xs">
          <span>Flatten subfolders</span>
          <Switch
            data-testid="flatten"
            aria-label="Flatten subfolders"
            checked={options.flatten}
            onCheckedChange={(flatten) => patch({ flatten })}
          />
        </div>
        {showBanner && (
          <div
            data-testid="decoder-banner"
            className="flex gap-2 rounded-lg border border-amber-400/35 bg-amber-400/8 p-2"
          >
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
            <div className="flex flex-col gap-1 text-[11px]">
              <span className="font-semibold text-amber-400">
                Exporting with RAW 8
              </span>
              <span className="text-muted-foreground">
                {someSupport && support
                  ? `RAW 9 resolves more detail and denoises harder on ${support.raw9} of these photos, but they will look different from the previews you culled against.`
                  : "RAW 9 resolves more detail and denoises harder, but the exported photos will look different from the previews you culled against."}
              </span>
              <span className="mt-1 flex items-center gap-2.5">
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="banner-use-raw9"
                  onClick={() => patch({ decoderVersion: 9 })}
                  className="h-5 border-amber-400/45 px-2 text-[10px] text-amber-400"
                >
                  Use RAW 9
                </Button>
                <button
                  type="button"
                  data-testid="banner-keep-raw8"
                  onClick={() => setKeepRaw8(true)}
                  className="text-[10px] text-muted-foreground underline underline-offset-2"
                >
                  Keep RAW 8
                </button>
              </span>
            </div>
          </div>
        )}
        <Button
          size="sm"
          data-testid="run-export"
          disabled={selectedCount === 0 || busy}
          onClick={() => void runExport()}
          className="mt-1 w-full text-xs"
        >
          <Upload />
          {selectedCount === 0
            ? "Export"
            : exportLabel(selectedCount, options.format)}
        </Button>
      </Section>

      {jobs.length > 0 && (
        <Section label="Activity">
          <ul className="flex flex-col gap-2">
            {jobs.map((job) => {
              const status = jobStatus(job);
              const settled = job.done + job.failed;
              return (
                <li
                  key={job.key}
                  data-testid={`job-${status}`}
                  className="flex flex-col gap-0.5 text-xs"
                >
                  <span className="flex items-center gap-1.5">
                    {status === "running" && (
                      <span className="size-2 shrink-0 animate-pulse rounded-full bg-primary" />
                    )}
                    {status === "done" && (
                      <Check className="size-3.5 shrink-0 text-emerald-400" />
                    )}
                    {status === "cancelled" && (
                      <X className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    {status === "partial" && (
                      <AlertCircle className="size-3.5 shrink-0 text-amber-400" />
                    )}
                    {status === "failed" && (
                      <AlertCircle className="size-3.5 shrink-0 text-destructive" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{job.label}</span>
                    {status === "running" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        data-testid="job-cancel"
                        title="Cancel export"
                        onClick={() => onCancel(job.key)}
                        className="size-5 shrink-0 text-muted-foreground"
                      >
                        <X />
                      </Button>
                    )}
                    {/* A cancelled zip deletes its staging, so there is no
                        archive at the path to reveal. */}
                    {!job.running && job.done > 0 && (
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Reveal in Finder"
                        onClick={() => onReveal(job.destination)}
                        className="size-5 shrink-0 text-muted-foreground"
                      >
                        <FolderOpen />
                      </Button>
                    )}
                  </span>
                  {status === "running" && (
                    <Progress
                      data-testid="job-bar"
                      value={(settled / Math.max(job.total, 1)) * 100}
                      className={cn(
                        "ml-5 h-0.5 bg-border",
                        job.archiving && "animate-pulse",
                      )}
                    />
                  )}
                  <span
                    title={jobDetail(job, status, settled)}
                    className="truncate pl-5 font-mono text-[10px] text-muted-foreground"
                  >
                    {jobDetail(job, status, settled)}
                  </span>
                  {job.failures.length > 0 && (
                    <details className="pl-5 text-[10px] text-muted-foreground">
                      <summary className="cursor-pointer">
                        Which {job.failures.length === 1 ? "file" : "files"}?
                      </summary>
                      <ul
                        data-testid="job-failures"
                        className="max-h-32 overflow-y-auto font-mono"
                      >
                        {job.failures.map((failure) => (
                          <li
                            key={failure}
                            className="truncate"
                            title={failure}
                          >
                            {failure}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </div>
  );
}
