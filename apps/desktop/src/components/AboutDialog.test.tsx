import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Updater, useUpdater } from "@/lib/useUpdater";
import { AboutDialog } from "./AboutDialog";

const { check, relaunch, getVersion, downloadAndInstall } = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
  getVersion: vi.fn(),
  downloadAndInstall: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion }));

vi.stubEnv("PROD", true);

function Harness({
  blocked,
  capture,
}: {
  blocked: string | null;
  capture?: (updater: Updater) => void;
}) {
  const updater = useUpdater();
  capture?.(updater);
  return (
    <AboutDialog
      open
      onOpenChange={() => {}}
      updater={updater}
      onInstall={updater.install}
      blocked={blocked}
    />
  );
}

function renderDialog(
  blocked: string | null = null,
  capture?: (updater: Updater) => void,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Harness blocked={blocked} capture={capture} />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  check.mockReset().mockResolvedValue(null);
  relaunch.mockReset().mockResolvedValue(undefined);
  getVersion.mockReset().mockResolvedValue("1.2.3");
  downloadAndInstall.mockReset().mockResolvedValue(undefined);
});

describe("AboutDialog", () => {
  const hasStatus = (text: string) =>
    waitFor(() =>
      expect(screen.getByTestId("update-status")).toHaveTextContent(text),
    );

  const showsVersion = () =>
    waitFor(() =>
      expect(screen.getByTestId("app-version")).toHaveTextContent(
        "Version 1.2.3",
      ),
    );

  it("shows the running version", async () => {
    renderDialog();
    await showsVersion();
  });

  it("reports being up to date", async () => {
    renderDialog();
    fireEvent.click(screen.getByTestId("check-updates"));
    await hasStatus("Up to date.");
  });

  it("offers an available update and installs it", async () => {
    check.mockResolvedValue({
      version: "2.0.0",
      body: "Faster exports",
      downloadAndInstall,
    });
    renderDialog();

    await hasStatus("Photopipe 2.0.0 is available");
    fireEvent.click(screen.getByTestId("install-update"));

    await waitFor(() => expect(relaunch).toHaveBeenCalled());
    expect(downloadAndInstall).toHaveBeenCalled();
  });

  it("will not install while an export is running", async () => {
    check.mockResolvedValue({ version: "2.0.0", downloadAndInstall });
    renderDialog("Finish the running export first.");

    await hasStatus("Finish the running export first.");
    fireEvent.click(screen.getByTestId("install-update"));
    expect(downloadAndInstall).not.toHaveBeenCalled();
  });

  it("installs once even when install is called twice", async () => {
    check.mockResolvedValue({ version: "2.0.0", downloadAndInstall });
    let updater!: Updater;
    renderDialog(null, (u) => {
      updater = u;
    });

    await hasStatus("Photopipe 2.0.0 is available");
    await act(async () => {
      await Promise.all([updater.install(), updater.install()]);
    });

    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it("surfaces the reason a manual check failed", async () => {
    check.mockRejectedValue(new Error("no internet"));
    renderDialog();
    fireEvent.click(screen.getByTestId("check-updates"));
    await hasStatus("no internet");
  });

  it("stays quiet when the check on launch fails", async () => {
    check.mockRejectedValue(new Error("no internet"));
    renderDialog();
    await showsVersion();
    expect(screen.getByTestId("update-status")).toBeEmptyDOMElement();
  });
});
