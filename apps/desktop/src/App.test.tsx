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
  it("asks for a root folder when none is stored", () => {
    renderWithQueries(<App />);
    expect(screen.getByTestId("root-input")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reconnects a stored root and shows the dashboard", async () => {
    localStorage.setItem("photopipe.root", "/r");
    invoke.mockImplementation(async (_cmd, args) => {
      const { method } = args as { method: string };
      if (method === "setRoot") return { shoots: 1, files: 4, generation: 1 };
      if (method === "listShoots") return { shoots: [SHOOT] };
      if (method === "status") return { generation: 1, root: "/r", shoots: 1 };
      throw new Error(`unexpected ${method}`);
    });

    renderWithQueries(<App />);
    const entry = await screen.findByTestId("shoot-2026-07-12_zell");
    expect(within(entry).getByText("4 photos")).toBeInTheDocument();
  });

  it("opens settings from the menu bar before a folder is picked", async () => {
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

  it("drops back to the picker with the error when setRoot fails", async () => {
    localStorage.setItem("photopipe.root", "/gone");
    invoke.mockRejectedValue("root_not_found: /gone");

    renderWithQueries(<App />);
    expect(await screen.findByTestId("root-error")).toHaveTextContent(
      "root_not_found",
    );
    expect(localStorage.getItem("photopipe.root")).toBeNull();
  });
});
