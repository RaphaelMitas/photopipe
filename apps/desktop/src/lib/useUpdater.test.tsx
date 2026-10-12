import { fireEvent, render, screen } from "@testing-library/react";
import { Toaster } from "sonner";
import { afterEach, expect, it, vi } from "vitest";
import { useUpdater } from "./useUpdater";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const findUpdate = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-updater", () => ({ check: findUpdate }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function Updater({ blockedReason }: { blockedReason: string | null }) {
  useUpdater({ blockedReason, beforeInstall: () => {} });
  return <Toaster />;
}

it("Install checks the block when clicked and keeps the reason on screen", async () => {
  vi.stubEnv("PROD", true);
  invoke.mockResolvedValue(true);
  const update = {
    version: "2.0.0",
    close: vi.fn(),
    downloadAndInstall: vi.fn(),
  };
  findUpdate.mockResolvedValue(update);
  const { rerender } = render(<Updater blockedReason={null} />);
  const installButton = await screen.findByRole("button", { name: "Install" });

  rerender(<Updater blockedReason="Finish the running job first" />);
  fireEvent.click(installButton);
  await screen.findByText("Finish the running job first");
  await new Promise((resolve) => setTimeout(resolve, 500));

  expect(screen.getByText("Finish the running job first")).toBeInTheDocument();
  expect(update.downloadAndInstall).not.toHaveBeenCalled();
});
