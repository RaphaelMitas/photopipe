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

/// Stands in for the shell: `remembered` are the roots it would reopen, and
/// `core` answers the sidecar methods this test cares about.
function mockShell(
  remembered: string[],
  core: (method: string, params: Record<string, unknown>) => unknown,
) {
  invoke.mockImplementation(async (cmd, args) => {
    if (cmd === "list_roots") return remembered;
    if (cmd === "open_root" || cmd === "remember_root") return null;
    if (cmd !== "core_request") throw new Error(`unexpected command ${cmd}`);
    const { method, params } = args as {
      method: string;
      params: Record<string, unknown>;
    };
    return core(method, params ?? {});
  });
}

describe("App", () => {
  it("asks for a root folder when none is remembered", async () => {
    mockShell([], (method) => {
      throw new Error(`unexpected ${method}`);
    });
    renderWithQueries(<App />);
    expect(await screen.findByTestId("root-input")).toBeInTheDocument();
  });

  it("reconnects a remembered root and shows the dashboard", async () => {
    mockShell(["/r"], (method) => {
      if (method === "setRoot") return { shoots: 1, files: 4, generation: 1 };
      if (method === "listShoots") return { shoots: [SHOOT] };
      if (method === "status") return { generation: 1, root: "/r", shoots: 1 };
      throw new Error(`unexpected ${method}`);
    });

    renderWithQueries(<App />);
    const entry = await screen.findByTestId("shoot-2026-07-12_zell");
    expect(within(entry).getByText("4 photos")).toBeInTheDocument();
  });

  it("regains access to the root before the core is asked to scan it", async () => {
    mockShell(["/r"], (method) => {
      if (method === "setRoot") return { shoots: 0, files: 0, generation: 1 };
      if (method === "listShoots") return { shoots: [] };
      if (method === "status") return { generation: 1, root: "/r", shoots: 0 };
      throw new Error(`unexpected ${method}`);
    });
    const shellCalls = () =>
      invoke.mock.calls
        .map(([cmd, args]) =>
          cmd === "core_request" ? (args as { method: string }).method : cmd,
        )
        .filter((call: string) => call !== "list_roots");

    renderWithQueries(<App />);
    await screen.findByText("Library");
    await waitFor(() => expect(shellCalls()).toContain("remember_root"));
    // The bookmark has to be resolved before the core touches the folder, and
    // a root the core never accepted must not become the one we reopen.
    const calls = shellCalls();
    expect(calls.slice(0, 2)).toEqual(["open_root", "setRoot"]);
    expect(calls.indexOf("remember_root")).toBeGreaterThan(
      calls.indexOf("setRoot"),
    );
  });

  it("opens settings from the menu bar before a folder is picked", async () => {
    mockShell([], (method) => {
      throw new Error(`unexpected ${method}`);
    });
    renderWithQueries(<App />);
    expect(await screen.findByTestId("root-input")).toBeInTheDocument();

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

  it("drops back to the picker with the error when setRoot fails", async () => {
    mockShell(["/gone"], () => {
      throw "root_not_found: /gone";
    });

    renderWithQueries(<App />);
    expect(await screen.findByTestId("root-error")).toHaveTextContent(
      "root_not_found",
    );
  });

  it("keeps a root the shell cannot reopen out of the core's way", async () => {
    invoke.mockImplementation(async (cmd) => {
      if (cmd === "list_roots") return ["/gone"];
      if (cmd === "open_root") throw "macOS would not reopen /gone";
      throw new Error(`unexpected command ${cmd}`);
    });

    renderWithQueries(<App />);
    expect(await screen.findByTestId("root-error")).toHaveTextContent(
      "would not reopen",
    );
  });
});
