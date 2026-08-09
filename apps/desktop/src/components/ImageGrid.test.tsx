import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ImageGroup } from "@/lib/core";
import { ImageGrid } from "./ImageGrid";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => ({ cachePath: "/fake/thumb.jpg" })),
  convertFileSrc: (path: string) => `asset://${path}`,
}));

function makeImages(count: number): ImageGroup[] {
  return Array.from({ length: count }, (_, i) => ({
    stem: `DSC${String(i).padStart(5, "0")}`,
    stage: "raw" as const,
    rating: 0,
    width: 3000,
    height: 2000,
    files: [
      {
        path: `/r/s/DSC${String(i).padStart(5, "0")}.ARW`,
        ext: "ARW",
        stage: "raw" as const,
        size: 1,
        mtime: 1,
      },
    ],
  }));
}

describe("ImageGrid virtualization", () => {
  it("renders only the visible window of a large shoot", () => {
    // jsdom has no layout: give every element an 800x600 box so the
    // virtualizer and the column calculation see a real viewport.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      get: () => 800,
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      get: () => 600,
      configurable: true,
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <ImageGrid
          images={makeImages(500)}
          initialRect={{ width: 800, height: 600 }}
        />
      </QueryClientProvider>,
    );
    const rendered = screen.getAllByTestId("thumb").length;
    expect(rendered).toBeGreaterThan(0);
    // 800px wide → 4 columns; 600px tall + overscan → a handful of rows, never 500 cells.
    expect(rendered).toBeLessThan(50);
  });
});
