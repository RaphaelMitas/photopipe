import { Loader2 } from "lucide-react";
import { useAppVersion } from "@/lib/queries";
import type { Updater } from "@/lib/useUpdater";
import { Photopipe } from "./Photopipe";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

function Status({ state }: { state: Updater["state"] }) {
  switch (state.kind) {
    case "checking":
      return <span className="text-muted-foreground">Checking…</span>;
    case "current":
      return <span className="text-muted-foreground">Up to date.</span>;
    case "available":
      return (
        <span>
          Photopipe {state.version} is available.
          {state.notes && (
            <span className="mt-1 block text-muted-foreground">
              {state.notes}
            </span>
          )}
        </span>
      );
    case "downloading":
      return (
        <span className="text-muted-foreground">
          {state.percent === null
            ? "Downloading…"
            : `Downloading… ${state.percent}%`}
        </span>
      );
    case "installed":
      return <span className="text-muted-foreground">Restarting…</span>;
    case "error":
      return <span className="text-destructive">{state.message}</span>;
    default:
      return null;
  }
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  updater: Updater;
};

export function AboutDialog({ open, onOpenChange, updater }: Props) {
  const version = useAppVersion(open);
  const { state } = updater;
  const busy = state.kind === "checking" || state.kind === "downloading";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Photopipe className="size-8 shrink-0" />
            <div>
              <DialogTitle className="font-heading">Photopipe</DialogTitle>
              <DialogDescription
                data-testid="app-version"
                className="font-mono text-xs"
              >
                {version.data ? `Version ${version.data}` : "—"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <p data-testid="update-status" className="text-sm empty:hidden">
          <Status state={state} />
        </p>

        <DialogFooter>
          {state.kind === "available" ? (
            <Button data-testid="install-update" onClick={updater.install}>
              Install and restart
            </Button>
          ) : (
            <Button
              variant="outline"
              data-testid="check-updates"
              disabled={busy}
              onClick={updater.check}
            >
              {busy && <Loader2 className="animate-spin" />}
              Check for updates
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
