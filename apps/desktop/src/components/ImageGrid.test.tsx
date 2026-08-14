import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ImageFile } from "@/lib/core";
import { makeImage } from "@/lib/test-image";
import { ImageGrid } from "./ImageGrid";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => ({ cachePath: "/fake/thumb.jpg" })),
  convertFileSrc: (path: string) => `asset://${path}`,
}));

function makeImages(count: number): ImageFile[] {
  return Array.from({ length: count }, (_, i) =>
    makeImage(`DSC${String(i).padStart(5, "0")}.ARW`),
  );
}

describe("ImageGrid virtualization", () => {
  it("renders only the visible window of a large shoot", () => {
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
    expect(rendered).toBeLessThan(50);
  });
});
