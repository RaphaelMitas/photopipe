import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useUpdater } from "./useUpdater";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const findUpdate = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-updater", () => ({ check: findUpdate }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
const toast = vi.hoisted(() =>
  Object.assign(
    vi.fn<
      (message: string, options: { action: { onClick: () => void } }) => void
    >(),
    { error: vi.fn(), loading: vi.fn(), success: vi.fn() },
  ),
);
vi.mock("sonner", () => ({ toast }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it("Install checks the block when clicked, not when the offer appeared", async () => {
  vi.stubEnv("PROD", true);
  invoke.mockResolvedValue(true);
  const update = {
    version: "2.0.0",
    close: vi.fn(),
    downloadAndInstall: vi.fn(),
  };
  findUpdate.mockResolvedValue(update);
  let blockedReason: string | null = null;
  const { rerender } = renderHook(() =>
    useUpdater({ blockedReason, beforeInstall: vi.fn() }),
  );
  await waitFor(() => expect(toast).toHaveBeenCalled());

  blockedReason = "Finish the running job first";
  rerender();
  act(() => toast.mock.calls[0][1].action.onClick());

  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Finish the running job first", {
      id: "update",
    }),
  );
  expect(update.downloadAndInstall).not.toHaveBeenCalled();
});
