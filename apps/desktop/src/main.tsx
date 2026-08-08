import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Playwright runs the UI in a plain browser: swap the Tauri IPC layer for mocks.
async function prepare() {
  if (import.meta.env.VITE_E2E === "1") {
    const { mockIPC } = await import("@tauri-apps/api/mocks");
    mockIPC((cmd, args) => {
      const method = (args as { method?: string } | undefined)?.method;
      if (cmd === "core_request" && method === "version") {
        return { version: "0.0.0-e2e", protocol: 1 };
      }
      if (cmd === "core_request" && method === "ping") {
        return { pong: true };
      }
      throw new Error(`unmocked IPC call: ${cmd} ${method ?? ""}`);
    });
  }
}

prepare().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
