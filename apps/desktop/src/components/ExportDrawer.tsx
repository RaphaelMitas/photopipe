import { Button } from "@photopipe/ui/components/button";
import { Segmented } from "@photopipe/ui/components/segmented";
import { Switch } from "@photopipe/ui/components/switch";
import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { AlertCircle, Check, FolderOpen, Upload, X } from "lucide-react";
import { useState } from "react";
import type { ExportFormat } from "@/lib/core";
import { type ExportJob, jobStatus } from "@/lib/queries";

export type ExportOptions = {
  format: ExportFormat;
  quality: number;
  zip: boolean;
  flatten: boolean;
};

type Props = {
  shoot: string;
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

/// From how long the files that already landed took. Held back until a few are
/// in, because the first render of a shoot pays for a cold cache and would
/// promise a number nothing else lives up to.
function timeLeft(job: ExportJob): string {
  const elapsed = Date.now() - job.startedAt;
  const settled = job.done + job.failed;
  if (settled < 3 || elapsed < 2000) return "";
  const remaining = ((job.total - settled) * elapsed) / settled / 1000;
  if (remaining < 60) return " · under a minute left";
  return ` · about ${Math.round(remaining / 60)} min left`;
}

function jobDetail(job: ExportJob): string {
  if (job.running) {
    // Settled, not delivered: a count that skipped the failures would sit
    // still while the bar and the estimate kept moving.
    const failed = job.failed > 0 ? ` · ${job.failed} failed` : "";
    return `${job.done + job.failed} of ${job.total}${failed}${timeLeft(job)}`;
  }
  if (job.error) return job.error;
  const files = `${job.done} ${job.done === 1 ? "file" : "files"}`;
  const failed = job.failed > 0 ? ` · ${job.failed} failed` : "";
  const stopped = job.cancelled ? "Cancelled · " : "";
  return `${stopped}${files}${failed} · ${job.destination}`;
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
      };
    }
  } catch {
    // Corrupt preferences never block an export.
  }
  return { format: "jpeg", quality: 90, zip: false, flatten: true };
}

export function ExportDrawer({
  shoot,
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
    if (destination) onExport(options, destination);
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
            : `Export ${selectedCount} ${
                options.format === "jpeg" ? "as JPEG" : "originals"
              }`}
        </Button>
      </Section>

      {jobs.length > 0 && (
        <Section label="Activity">
          <ul className="flex flex-col gap-2">
            {jobs.map((job) => {
              const status = jobStatus(job);
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
                    {(status === "done" || status === "cancelled") && (
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
                    <span className="ml-5 h-0.5 overflow-hidden rounded-full bg-border">
                      <span
                        data-testid="job-bar"
                        className="block h-full bg-primary transition-[width] duration-200"
                        style={{
                          width: `${Math.round(((job.done + job.failed) / Math.max(job.total, 1)) * 100)}%`,
                        }}
                      />
                    </span>
                  )}
                  <span className="truncate pl-5 font-mono text-[10px] text-muted-foreground">
                    {jobDetail(job)}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </div>
  );
}
