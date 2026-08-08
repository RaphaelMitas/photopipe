import process from "node:process";
import { defineConfig } from "@playwright/test";

// Dedicated port: `tauri dev` owns 1420, and reusing its server would lack
// VITE_E2E (no mockIPC). e2e always talks to its own server on 1421.
export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://localhost:1421",
  },
  webServer: {
    command: "pnpm dev --port 1421 --strictPort",
    port: 1421,
    reuseExistingServer: !process.env.CI,
    env: { VITE_E2E: "1" },
  },
});
