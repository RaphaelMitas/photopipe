import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  convertFileSrc: (path: string) => `asset://${path}`,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const menu = vi.hoisted(() => new Map<string, (event: unknown) => void>());
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (event: string, handler: (event: unknown) => void) => {
    menu.set(event, handler);
    return () => menu.delete(event);
  },
}));

function chooseMenuItem(event: string) {
  const handler = menu.get(event);
  if (!handler) throw new Error(`nothing listening for ${event}`);
  act(() => handler({ event, payload: null }));
}

function renderWithQueries(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

const SHOOT = {
  name: "2026-07-12_zell",
  path: "/r/2026-07-12_zell",
  day: "2026-07-12",
  project: "zell",
  imageCount: 4,
  notes: "",
  cover: null,
  coverPath: null,
};

afterEach(cleanup);

beforeEach(() => {
  invoke.mockReset();
  localStorage.clear();
  menu.clear();
});

describe("App", () => {
  it("asks for a root folder when the shell remembers none", async () => {
    invoke.mockImplementation(async (cmd) => {
      if (cmd === "list_roots") return [];
      throw new Error(`unexpected ${cmd}`);
    });
    renderWithQueries(<App />);
    expect(screen.getByTestId("root-input")).toBeInTheDocument();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("list_roots"));
    expect(invoke).not.toHaveBeenCalledWith("open_root", expect.anything());
    // The picker's list and the launch decision share one query.
    expect(
      invoke.mock.calls.filter(([cmd]) => cmd === "list_roots"),
    ).toHaveLength(1);
  });

  it("carries the root a pre-bookmark build kept in localStorage over to the shell", async () => {
    localStorage.setItem("photopipe.root", "/old");
    localStorage.setItem("photopipe.recentRoots", JSON.stringify(["/old"]));
    invoke.mockImplementation(async (cmd) => {
      if (cmd === "list_roots") return [];
      throw { kind: "denied", message: "sandboxed" };
    });

    renderWithQueries(<App />);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("open_root", { path: "/old" }),
    );
    expect(await screen.findByTestId("root-error")).toHaveAttribute(
      "data-kind",
      "denied",
    );
    expect(localStorage.getItem("photopipe.root")).toBe("/old");
  });

  it("drops the legacy keys once the shell has the folder", async () => {
    localStorage.setItem("photopipe.root", "/old");
    localStorage.setItem("photopipe.recentRoots", JSON.stringify(["/old"]));
    invoke.mockImplementation(async (cmd, args) => {
      if (cmd === "list_roots") return [];
      if (cmd === "open_root")
        return { path: "/old", shoots: 1, files: 4, generation: 1 };
      const { method } = args as { method: string };
      if (method === "listShoots") return { shoots: [SHOOT] };
      if (method === "status")
        return { generation: 1, root: "/old", shoots: 1 };
      throw new Error(`unexpected ${method}`);
    });

    renderWithQueries(<App />);
    await waitFor(() =>
      expect(localStorage.getItem("photopipe.root")).toBeNull(),
    );
    expect(localStorage.getItem("photopipe.recentRoots")).toBeNull();
  });

  it("reopens the last root through the shell and shows the dashboard", async () => {
    invoke.mockImplementation(async (cmd, args) => {
      if (cmd === "list_roots") return [{ path: "/r", status: "ok" }];
      if (cmd === "open_root") {
        expect(args).toEqual({ path: "/r" });
        return { path: "/r", shoots: 1, files: 4, generation: 1 };
      }
      const { method } = args as { method: string };
      if (method === "listShoots") return { shoots: [SHOOT] };
      if (method === "status") return { generation: 1, root: "/r", shoots: 1 };
      throw new Error(`unexpected ${method}`);
    });

    renderWithQueries(<App />);
    const entry = await screen.findByTestId("shoot-2026-07-12_zell");
    expect(within(entry).getByText("4 photos")).toBeInTheDocument();
  });

  it("opens settings from the menu bar before a folder is picked", async () => {
    invoke.mockResolvedValue([]);
    renderWithQueries(<App />);
    expect(screen.getByTestId("root-input")).toBeInTheDocument();

    chooseMenuItem("menu:settings");
    expect(await screen.findByTestId("auto-score")).toBeInTheDocument();

    // And again after closing it, not just the first time.
    act(() => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
    await waitFor(() =>
      expect(screen.queryByTestId("auto-score")).not.toBeInTheDocument(),
    );
    chooseMenuItem("menu:settings");
    expect(await screen.findByTestId("auto-score")).toBeInTheDocument();
  });

  it("stays on the picker with the shell's error when reopening fails", async () => {
    invoke.mockImplementation(async (cmd) => {
      if (cmd === "list_roots") return [{ path: "/gone", status: "ok" }];
      throw { kind: "failed", message: "root_not_found: /gone" };
    });

    renderWithQueries(<App />);
    expect(await screen.findByTestId("root-error")).toHaveTextContent(
      "root_not_found",
    );
    expect(screen.getByTestId("root-input")).toBeInTheDocument();
  });
});
