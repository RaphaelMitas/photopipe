import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { Photopipe } from "./Photopipe";

type Props = {
  error?: string | null;
  busy?: boolean;
  onSubmit: (path: string) => void;
};

export function RootPicker({ error, busy, onSubmit }: Props) {
  const [path, setPath] = useState("");

  async function pickFolder() {
    try {
      const dir = await open({
        directory: true,
        title: "Choose your photos folder",
      });
      if (typeof dir === "string") onSubmit(dir);
    } catch {
      // Dialog unavailable (e2e browser) — the text input still works.
    }
  }

  return (
    <main className="flex h-screen items-center justify-center bg-background text-foreground">
      <div className="w-[28rem] rounded-xl border bg-card p-8 text-card-foreground">
        <div className="flex items-center gap-3">
          <Photopipe className="h-10 w-10" />
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Photopipe
          </h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Point me at the folder that holds your{" "}
          <span className="font-mono">&lt;day&gt;_&lt;project&gt;</span> shoots.
        </p>
        <button
          type="button"
          onClick={pickFolder}
          disabled={busy}
          className="mt-6 w-full rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          Choose folder…
        </button>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (path.trim()) onSubmit(path.trim());
          }}
        >
          <input
            data-testid="root-input"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="…or type a path"
            className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="submit"
            data-testid="root-submit"
            disabled={busy}
            className="rounded-lg border px-4 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
          >
            Open
          </button>
        </form>
        {error && (
          <p data-testid="root-error" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
