import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImageFile } from "@/lib/core";
import { makeImage as image } from "@/lib/test-image";
import { ImageList } from "./ImageList";

afterEach(cleanup);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => ({ cachePath: "/fake/thumb.jpg" })),
  convertFileSrc: (path: string) => `asset://${path}`,
}));

function renderList(images: ImageFile[], onOpen?: (index: number) => void) {
  const onSelect = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ImageList
        images={images}
        selected={new Set(["/r/s/B.ARW"])}
        selectMode={false}
        onSelect={onSelect}
        onOpen={onOpen}
        emptyMessage="nothing here"
        initialRect={{ width: 900, height: 600 }}
      />
    </QueryClientProvider>,
  );
  return { onSelect };
}

describe("ImageList", () => {
  it("shows every file as its own row, subfolders included", () => {
    renderList([
      image("A.ARW"),
      image("A.jpg", { rating: 4 }),
      image("Tag2/A.ARW", { exposure: 0.5 }),
    ]);

    const rows = screen.getAllByTestId("image-row");
    expect(rows).toHaveLength(3);
    expect(rows[0].dataset.path).toBe("A.ARW");
    expect(rows[1].dataset.path).toBe("A.jpg");
    expect(rows[1].textContent).toContain("4");
    expect(rows[2].dataset.path).toBe("Tag2/A.ARW");
    expect(rows[2].textContent).toContain("+0.5");
  });

  it("reflects and reports selection", () => {
    const { onSelect } = renderList([image("A.ARW"), image("B.ARW")]);
    const rows = screen.getAllByTestId("image-row");
    expect(rows[1].dataset.selected).toBe("true");

    fireEvent.click(rows[0], { metaKey: true });
    expect(onSelect).toHaveBeenCalledWith("/r/s/A.ARW", {
      meta: true,
      shift: false,
    });

    fireEvent.click(rows[1]);
    expect(onSelect).toHaveBeenLastCalledWith("/r/s/B.ARW", {
      meta: true,
      shift: false,
    });
  });

  it("says so when there is nothing to work on", () => {
    renderList([]);
    expect(screen.getByTestId("list-empty").textContent).toBe("nothing here");
  });
});
