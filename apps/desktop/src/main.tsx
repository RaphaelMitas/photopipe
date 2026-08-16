import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Toaster } from "./components/ui/sonner";
import "./index.css";

async function prepare() {
  if (import.meta.env.VITE_E2E === "1") {
    const { mockIPC } = await import("@tauri-apps/api/mocks");
    const { E2E_HANDLERS, E2E_SHELL_HANDLERS } = await import("./e2e-mocks");
    mockIPC((cmd, args) => {
      if (cmd === "core_request") {
        const method = (args as { method?: string } | undefined)?.method;
        const params = (
          args as { params?: Record<string, unknown> } | undefined
        )?.params;
        const handler = method ? E2E_HANDLERS[method] : undefined;
        if (!handler)
          throw new Error(`unmocked IPC call: ${cmd} ${method ?? ""}`);
        return handler(params ?? {});
      }
      const shell = E2E_SHELL_HANDLERS[cmd];
      if (!shell) throw new Error(`unmocked IPC call: ${cmd}`);
      return shell((args as Record<string, unknown>) ?? {});
    });
  }
}

prepare().then(() => {
  const queryClient = new QueryClient();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
        <Toaster richColors position="bottom-right" />
      </QueryClientProvider>
    </React.StrictMode>,
  );
});
