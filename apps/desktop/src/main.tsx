import { Toaster } from "@photopipe/ui/components/sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

async function prepare() {
  if (import.meta.env.VITE_E2E === "1") {
    const { mockIPC } = await import("@tauri-apps/api/mocks");
    const { answerCoreRequest, E2E_COMMANDS, isCoreRequest } = await import(
      "./e2e-mocks"
    );
    mockIPC((cmd, args) => {
      // The save panel is an OS window with nothing to drive it from a browser.
      if (cmd === "plugin:dialog|save") return "/fake/delivery";
      if (cmd === "plugin:opener|reveal_item_in_dir") return null;
      if (cmd in E2E_COMMANDS) return E2E_COMMANDS[cmd](args);
      if (cmd === "core_request" && isCoreRequest(args)) {
        return answerCoreRequest(args);
      }
      throw new Error(`unmocked IPC call: ${cmd} ${JSON.stringify(args)}`);
    });
  }
}

prepare().then(() => {
  // The core is a local process: being offline must not pause a write to disk.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { networkMode: "always" },
      mutations: { networkMode: "always" },
    },
  });
  const root = document.getElementById("root");
  if (!root) throw new Error("index.html has no #root");
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
        <Toaster richColors position="bottom-right" />
      </QueryClientProvider>
    </React.StrictMode>,
  );
});
