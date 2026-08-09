import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImageGroup } from "@/lib/core";
import { Loupe } from "./Loupe";
import { LoupeSidebar } from "./LoupeSidebar";
import { SidebarProvider } from "./ui/sidebar";
import { TooltipProvider } from "./ui/tooltip";

afterEach(cleanup);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => ({ cachePath: "/fake/render.jpg" })),
  convertFileSrc: (path: string) => `asset://${path}`,
}));

function makeImages(): ImageGroup[] {
  return ["DSC00001", "DSC00002", "DSC00003"].map((stem) => ({
    stem,
    stage: "raw" as const,
    rating: 0,
    width: 3000,
    height: 2000,
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

function renderLoupe(index = 0, exposure = 0) {
  const onNavigate = vi.fn();
  const onClose = vi.fn();
  const onRate = vi.fn();
  const onExposureChange = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Loupe
        images={makeImages()}
        index={index}
        exposure={exposure}
        filmstrip="off"
        onExposureChange={onExposureChange}
        onNavigate={onNavigate}
        onClose={onClose}
        onRate={onRate}
      />
    </QueryClientProvider>,
  );
  return { onNavigate, onClose, onRate, onExposureChange };
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

  it("scrubs exposure with up/down arrows, clamped, and resets with r", () => {
    const { onExposureChange } = renderLoupe(0, 0.25);
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(onExposureChange).toHaveBeenCalledWith(0.5);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(onExposureChange).toHaveBeenCalledWith(0);
    fireEvent.keyDown(window, { key: "r" });
    expect(onExposureChange).toHaveBeenCalledWith(0);
  });

  it("clamps exposure at the range ceiling", () => {
    const { onExposureChange } = renderLoupe(0, 3);
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(onExposureChange).toHaveBeenCalledWith(3);
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
});

describe("LoupeSidebar", () => {
  it("shows stem, position and exposure; rates and resets", () => {
    const onRate = vi.fn();
    const onExposureChange = vi.fn();
    render(
      <TooltipProvider>
        <SidebarProvider>
          <LoupeSidebar
            image={makeImages()[1]}
            position={2}
            count={3}
            exposure={0.25}
            filmstrip="thumbs"
            onFilmstrip={vi.fn()}
            ratingOp="gte"
            onRatingOp={vi.fn()}
            ratingStars={0}
            onRatingStars={vi.fn()}
            onExposureChange={onExposureChange}
            onRate={onRate}
            onBackToGrid={vi.fn()}
          />
        </SidebarProvider>
      </TooltipProvider>,
    );
    expect(screen.getByTestId("loupe-stem").textContent).toBe("DSC00002");
    expect(screen.getByTestId("loupe-position").textContent).toBe("2/3");
    expect(screen.getByText("+0.25")).toBeVisible();

    fireEvent.click(screen.getByTestId("star-4"));
    expect(onRate).toHaveBeenCalledWith("DSC00002", 4);
    fireEvent.click(screen.getByTitle("Reset exposure (r)"));
    expect(onExposureChange).toHaveBeenCalledWith(0);
  });
});
