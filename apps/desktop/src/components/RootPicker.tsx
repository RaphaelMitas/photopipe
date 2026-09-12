import { Button } from "@photopipe/ui/components/button";
import { Input } from "@photopipe/ui/components/input";
import { Photopipe } from "@photopipe/ui/components/photopipe-mark";
import { PhotopipeWordmark } from "@photopipe/ui/components/photopipe-wordmark";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@photopipe/ui/components/tooltip";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen, History, Unplug, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { fileName } from "@/lib/fileName";
import {
  forgetRoot,
  type RootEntry,
  type RootError,
  rootsQuery,
} from "@/lib/roots";

type Props = {
  error?: RootError | null;
  busy?: boolean;
  onPick: (path?: string) => void;
};

const STATUS_HINT: Record<RootEntry["status"], string | null> = {
  ok: null,
  unplugged: "connect the drive",
  broken: "choose it again to reconnect",
};

function errorText(error: RootError): string {
  switch (error.kind) {
    case "denied":
      return "macOS did not let Photopipe open that folder. Allow it under System Settings > Privacy & Security > Files and Folders, or choose the folder again.";
    case "unplugged":
      return "That folder is not reachable right now. Connect the drive it lives on and try again.";
    case "missing":
      return `There is no folder at that path. Check it, or choose the folder with the panel. (${error.message})`;
    case "broken":
      return `Photopipe lost its access to that folder. Choose it again to reconnect. (${error.message})`;
    default:
      return error.message;
  }
}

export function RootPicker({ error, busy, onPick }: Props) {
  const [path, setPath] = useState("");
  const roots = useQuery(rootsQuery);

  return (
    <TooltipProvider>
      <main className="flex h-screen flex-col items-center justify-center gap-8 bg-background text-foreground">
        <div className="flex flex-col items-center gap-3">
          <Photopipe className="h-16 w-16" />
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            <PhotopipeWordmark />
          </h1>
          <p className="text-sm text-muted-foreground">
            Your shoots, from raw to export.
          </p>
        </div>

        <div className="flex w-80 flex-col gap-2">
          <Button size="lg" onClick={() => onPick()} disabled={busy}>
            <FolderOpen />
            Choose your photos folder
          </Button>
          {(roots.data ?? []).map((root) => (
            <div key={root.path} className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    data-testid="recent-root"
                    data-status={root.status}
                    onClick={() =>
                      onPick(root.status === "broken" ? undefined : root.path)
                    }
                    className={`min-w-0 flex-1 justify-start text-muted-foreground ${
                      root.status === "ok" ? "" : "opacity-50"
                    }`}
                  >
                    {root.status === "unplugged" ? (
                      <Unplug className="shrink-0" />
                    ) : (
                      <History className="shrink-0" />
                    )}
                    <span className="truncate">{fileName(root.path)}</span>
                    {STATUS_HINT[root.status] && (
                      <span className="ml-auto shrink-0 text-xs">
                        {STATUS_HINT[root.status]}
                      </span>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  collisionPadding={8}
                  className="max-w-[min(24rem,var(--radix-tooltip-content-available-width))] break-all font-mono text-xs"
                >
                  {root.path}
                </TooltipContent>
              </Tooltip>
              <Button
                variant="ghost"
                size="icon"
                disabled={busy}
                aria-label={`Forget ${fileName(root.path)}`}
                className="size-7 shrink-0 text-muted-foreground"
                onClick={() =>
                  forgetRoot(root.path)
                    .then(() => roots.refetch())
                    .catch((error) =>
                      toast.error("Could not forget that folder", {
                        description: String(error),
                      }),
                    )
                }
              >
                <X />
              </Button>
            </div>
          ))}
        </div>

        <form
          className="flex w-80 gap-2 opacity-60 transition-opacity focus-within:opacity-100 hover:opacity-100"
          onSubmit={(e) => {
            e.preventDefault();
            if (path.trim()) onPick(path.trim());
          }}
        >
          <Input
            data-testid="root-input"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="…or type a path"
            className="h-8 text-xs"
          />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            data-testid="root-submit"
            disabled={busy}
            className="h-8"
          >
            Open
          </Button>
        </form>

        {error && (
          <p
            data-testid="root-error"
            data-kind={error.kind}
            className="max-w-96 text-sm text-destructive"
          >
            {errorText(error)}
          </p>
        )}
      </main>
    </TooltipProvider>
  );
}
