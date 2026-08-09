import { useCallback, useEffect, useState } from "react";

/// App-wide preferences: which tools the hand-offs use. These are machine
/// settings, not project data, so they live in localStorage rather than in
/// any project's photopipe.json.
export type Settings = {
  /// Whether the flow has a denoise step at all. On by default: the pipeline
  /// this app is built around is raw → DNG → JPEG. Turning it off is an
  /// explicit choice for JPEG-first or no-denoise workflows, and then Media
  /// hands straight to the editor while Edit works from the originals.
  processing: boolean;
  /// The denoiser. May be null while processing is on but unconfigured; the
  /// first hand-off asks for it.
  processor: string | null;
  editor: string | null;
};

const KEY = "photopipe.settings";

export const NO_PROCESSING = "none";

export function appName(path: string | null): string | null {
  if (!path) return null;
  return (
    path
      .split("/")
      .pop()
      ?.replace(/\.app$/, "") ?? path
  );
}

function read(): Settings {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<Settings>;
      return {
        processing: parsed.processing ?? true,
        processor: parsed.processor ?? null,
        editor: parsed.editor ?? null,
      };
    }
  } catch {
    // Corrupt settings should never stop the app from opening.
  }
  // Migrate the per-page app paths the toolbar used to remember.
  return {
    processing: true,
    processor: localStorage.getItem("photopipe.app.media"),
    editor:
      localStorage.getItem("photopipe.app.edit") ??
      localStorage.getItem("photopipe.app.process"),
  };
}

/// Settings shared across the window: components read the same value and a
/// change in one panel is seen everywhere.
const listeners = new Set<(settings: Settings) => void>();
let current: Settings | null = null;

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(() => {
    current ??= read();
    return current;
  });

  useEffect(() => {
    listeners.add(setSettings);
    return () => {
      listeners.delete(setSettings);
    };
  }, []);

  const save = useCallback((next: Settings) => {
    current = next;
    localStorage.setItem(KEY, JSON.stringify(next));
    for (const listener of listeners) listener(next);
  }, []);

  return { settings, save };
}

/// Whether the denoise step is part of the flow at all.
export function processingEnabled(settings: Settings): boolean {
  return settings.processing;
}
