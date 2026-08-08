import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  convertFileSrc: (path: string) => `asset://${path}`,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

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
  counts: { raw: 2, denoised: 1, export: 1 },
  imageCount: 4,
};

beforeEach(() => {
  invoke.mockReset();
  localStorage.clear();
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
    expect(
      await screen.findByTestId("shoot-2026-07-12_zell"),
    ).toBeInTheDocument();
    expect(screen.getByText("2 raw")).toBeInTheDocument();
    expect(screen.getByText("1 denoised")).toBeInTheDocument();
    expect(screen.getByText("1 exported")).toBeInTheDocument();
  });

  it("drops back to the picker with the error when setRoot fails", async () => {
    localStorage.setItem("photopipe.root", "/gone");
    invoke.mockRejectedValue("root_not_found: /gone");

    renderWithQueries(<App />);
    expect(await screen.findByTestId("root-error")).toHaveTextContent(
      "root_not_found",
    );
    // A vanished root must not stick for the next launch.
    expect(localStorage.getItem("photopipe.root")).toBeNull();
  });
});
