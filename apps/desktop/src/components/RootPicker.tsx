import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, History } from "lucide-react";
import { useState } from "react";
import { Photopipe } from "./Photopipe";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

function folderName(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() || path;
}

const RECENT_KEY = "photopipe.recentRoots";

export function recentRoots(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((r) => typeof r === "string")
      : [];
  } catch {
    return [];
  }
}

export function rememberRoot(path: string) {
  const next = [path, ...recentRoots().filter((r) => r !== path)].slice(0, 5);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

type Props = {
  error?: string | null;
  busy?: boolean;
  onSubmit: (path: string) => void;
};

export function RootPicker({ error, busy, onSubmit }: Props) {
  const [path, setPath] = useState("");
  const recents = recentRoots();

  async function pickFolder() {
    try {
      const dir = await open({
        directory: true,
        title: "Choose your photos folder",
      });
      if (typeof dir === "string") onSubmit(dir);
    } catch {}
  }

  return (
    <TooltipProvider>
      <main className="flex h-screen flex-col items-center justify-center gap-8 bg-background text-foreground">
        <div className="flex flex-col items-center gap-3">
          <Photopipe className="h-16 w-16" />
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            Photopipe
          </h1>
          <p className="text-sm text-muted-foreground">
            Your shoots, from raw to export.
          </p>
        </div>

        <div className="flex w-80 flex-col gap-2">
          <Button size="lg" onClick={pickFolder} disabled={busy}>
            <FolderOpen />
            Choose your photos folder
          </Button>
          {recents.map((recent) => (
            <Tooltip key={recent}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => onSubmit(recent)}
                  className="justify-start text-muted-foreground"
                >
                  <History className="shrink-0" />
                  <span className="truncate">{folderName(recent)}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                collisionPadding={8}
                className="max-w-[min(24rem,var(--radix-tooltip-content-available-width))] break-all font-mono text-xs"
              >
                {recent}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        <form
          className="flex w-80 gap-2 opacity-60 transition-opacity focus-within:opacity-100 hover:opacity-100"
          onSubmit={(e) => {
            e.preventDefault();
            if (path.trim()) onSubmit(path.trim());
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
            className="max-w-96 text-sm text-destructive"
          >
            {error}
          </p>
        )}
      </main>
    </TooltipProvider>
  );
}
