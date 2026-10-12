import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Toaster, toast } from "sonner";
import { afterEach, expect, it, vi } from "vitest";
import { useUpdater } from "./useUpdater";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const findUpdate = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-updater", () => ({ check: findUpdate }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

afterEach(() => {
  cleanup();
  toast.dismiss();
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

it("Install drops the button once the download starts", async () => {
  vi.stubEnv("PROD", true);
  invoke.mockResolvedValue(true);
  const update = {
    version: "2.0.0",
    close: vi.fn(),
    downloadAndInstall: vi.fn(
      (onEvent: (event: { event: string; data: object }) => void) => {
        onEvent({ event: "Started", data: { contentLength: 100 } });
        onEvent({ event: "Progress", data: { chunkLength: 40 } });
        return new Promise(() => {});
      },
    ),
  };
  findUpdate.mockResolvedValue(update);
  render(<Updater blockedReason={null} />);

  fireEvent.click(await screen.findByRole("button", { name: "Install" }));
  await screen.findByText("Downloading update… 40%");

  expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
});
