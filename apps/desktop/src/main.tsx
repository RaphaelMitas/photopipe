import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Playwright runs the UI in a plain browser: swap the Tauri IPC layer for mocks.
async function prepare() {
  if (import.meta.env.VITE_E2E === "1") {
    const { mockIPC } = await import("@tauri-apps/api/mocks");
    const { E2E_HANDLERS } = await import("./e2e-mocks");
    mockIPC((cmd, args) => {
      const method = (args as { method?: string } | undefined)?.method;
      const params = (args as { params?: Record<string, unknown> } | undefined)
        ?.params;
      const handler =
        cmd === "core_request" && method ? E2E_HANDLERS[method] : undefined;
      if (!handler)
        throw new Error(`unmocked IPC call: ${cmd} ${method ?? ""}`);
      return handler(params ?? {});
    });
  }
}

prepare().then(() => {
  const queryClient = new QueryClient();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>,
  );
});
