import process from "node:process";
import { defineConfig } from "@playwright/test";

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
