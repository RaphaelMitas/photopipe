import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

type CoreVersion = { version: string; protocol: number };

export default function App() {
  const [version, setVersion] = useState<CoreVersion | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<CoreVersion>("core_request", { method: "version" })
      .then(setVersion)
      .catch((e) => setError(String(e)));
  }, []);

  let status = "connecting to core…";
  if (error) {
    status = `core unreachable: ${error}`;
  } else if (version) {
    status = `photopipe-core v${version.version} · protocol ${version.protocol}`;
  }

  return (
    <main className="flex h-screen items-center justify-center bg-neutral-950 text-neutral-100">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-center shadow-lg">
        <h1 className="text-2xl font-semibold tracking-tight">Photopipe</h1>
        <p className="mt-2 text-sm text-neutral-400">walking skeleton</p>
        <p className="mt-6 font-mono text-sm" data-testid="core-status">
          {status}
        </p>
      </div>
    </main>
  );
}
