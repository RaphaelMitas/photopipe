import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

import type { ImageGroup } from "@/lib/core";
import { Loupe } from "./Loupe";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => ({ cachePath: "/fake/render.jpg" })),
  convertFileSrc: (path: string) => `asset://${path}`,
}));

function makeImages(): ImageGroup[] {
  return ["DSC00001", "DSC00002", "DSC00003"].map((stem) => ({
    stem,
    stage: "raw" as const,
    rating: 0,
    files: [
      {
        path: `/r/s/${stem}.ARW`,
        ext: "ARW",
        stage: "raw" as const,
        size: 1,
        mtime: 1,
      },
    ],
  }));
}

function renderLoupe(index = 0) {
  const onNavigate = vi.fn();
  const onClose = vi.fn();
  const onRate = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Loupe
        images={makeImages()}
        index={index}
        onNavigate={onNavigate}
        onClose={onClose}
        onRate={onRate}
      />
    </QueryClientProvider>,
  );
  return { onNavigate, onClose, onRate };
}

describe("Loupe keyboard culling", () => {
  it("rates with digit keys and clears with 0", () => {
    const { onRate } = renderLoupe();
    fireEvent.keyDown(window, { key: "3" });
    expect(onRate).toHaveBeenCalledWith("DSC00001", 3);
    fireEvent.keyDown(window, { key: "0" });
    expect(onRate).toHaveBeenCalledWith("DSC00001", 0);
  });

  it("navigates with arrows and clamps at the edges", () => {
    const { onNavigate } = renderLoupe(0);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onNavigate).toHaveBeenCalledWith(1);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onNavigate).toHaveBeenCalledWith(0);
  });

  it("clamps forward navigation at the last image", () => {
    const { onNavigate } = renderLoupe(2);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onNavigate).toHaveBeenCalledWith(2);
  });

  it("scrubs exposure with up/down arrows and resets with r", () => {
    renderLoupe();
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(screen.getByText("+0.25")).toBeVisible();
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(screen.getByText("-0.25")).toBeVisible();
    fireEvent.keyDown(window, { key: "r" });
    expect(screen.getByText("+0.00")).toBeVisible();
  });

  it("closes on escape", () => {
    const { onClose } = renderLoupe();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("ignores shortcuts when a modifier is held", () => {
    const { onRate, onClose } = renderLoupe();
    fireEvent.keyDown(window, { key: "3", metaKey: true });
    fireEvent.keyDown(window, { key: "Escape", ctrlKey: true });
    expect(onRate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the current stem and position", () => {
    renderLoupe(1);
    expect(screen.getByTestId("loupe-stem").textContent).toBe("DSC00002");
    expect(screen.getByTestId("loupe-position").textContent).toBe("2/3");
  });
});
