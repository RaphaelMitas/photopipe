import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImageGroup, Stage } from "@/lib/core";
import { ImageList, type ListInfo } from "./ImageList";

afterEach(cleanup);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => ({ cachePath: "/fake/thumb.jpg" })),
  convertFileSrc: (path: string) => `asset://${path}`,
}));

function image(stem: string, stages: Stage[]): ImageGroup {
  return {
    stem,
    stage: stages[stages.length - 1],
    rating: 0,
    width: 3000,
    height: 2000,
    files: stages.map((stage) => ({
      path: `/r/s/${stem}.${stage}`,
      ext: stage,
      stage,
      size: 1,
      mtime: 1,
    })),
  };
}

function renderStage(
  images: ImageGroup[],
  info: ListInfo = { kind: "stage", produces: "denoised", label: "DNG" },
  onOpen?: (index: number) => void,
) {
  const onSelect = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ImageList
        images={images}
        info={info}
        selected={new Set(["B"])}
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
  it("shows which images this stage is still waiting for", () => {
    renderStage([
      image("A", ["raw"]),
      image("B", ["raw", "denoised"]),
      image("C", ["raw"]),
    ]);

    const rows = screen.getAllByTestId("stage-row");
    expect(rows).toHaveLength(3);
    // Presence of the produced file *is* the state — nothing is stored.
    expect(rows[0].dataset.done).toBe("false");
    expect(rows[1].dataset.done).toBe("true");
    expect(rows[0].textContent).toContain("waiting");
    expect(rows[1].textContent).toContain("done");
  });

  it("reflects and reports selection", () => {
    const { onSelect } = renderStage([
      image("A", ["raw"]),
      image("B", ["raw", "denoised"]),
    ]);
    const rows = screen.getAllByTestId("stage-row");
    expect(rows[1].dataset.selected).toBe("true");

    fireEvent.click(rows[0], { metaKey: true });
    expect(onSelect).toHaveBeenCalledWith("A", { meta: true, shift: false });

    // Without an opener even a plain click toggle-selects.
    fireEvent.click(rows[1]);
    expect(onSelect).toHaveBeenLastCalledWith("B", {
      meta: true,
      shift: false,
    });
  });

  it("says so when there is nothing to work on", () => {
    renderStage([]);
    expect(screen.getByTestId("stage-empty").textContent).toBe("nothing here");
  });
});
