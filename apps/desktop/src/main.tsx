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
      // The file pickers are OS windows with nothing to drive them from a
      // browser, so e2e answers them and moves on. Only the import picker
      // asks for many, and it wants photos rather than a destination.
      if (cmd.startsWith("plugin:dialog|")) {
        const options =
          args && "options" in args && typeof args.options === "object"
            ? args.options
            : null;
        return options && "multiple" in options && options.multiple
          ? [
              ...Array.from(
                { length: 5 },
                (_, i) => `/fake/card/DSC0900${i + 1}.ARW`,
              ),
              "/fake/card/notes.txt",
            ]
          : "/fake/delivery";
      }
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
