import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Edit, type ImageFile, identityEdit } from "@/lib/core";
import { makeImage } from "@/lib/test-image";
import { EditSidebar } from "./EditPanel";
import { Loupe } from "./Loupe";
import { LoupeSidebar } from "./LoupeSidebar";
import { SidebarProvider } from "./ui/sidebar";
import { TooltipProvider } from "./ui/tooltip";

afterEach(cleanup);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => ({ cachePath: "/fake/render.jpg" })),
  convertFileSrc: (path: string) => `asset://${path}`,
}));

const editWith = (exposure: number): Edit => ({ ...identityEdit, exposure });

function makeImages(): ImageFile[] {
  return ["DSC00001", "DSC00002", "DSC00003"].map((stem) =>
    makeImage(`${stem}.ARW`),
  );
}

function renderLoupe(index = 0, exposure = 0, cropping = false) {
  const onNavigate = vi.fn();
  const onClose = vi.fn();
  const onRate = vi.fn();
  const onEditChange = vi.fn();
  const onCroppingChange = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Loupe
        images={makeImages()}
        index={index}
        edit={editWith(exposure)}
        filmstrip="off"
        cropping={cropping}
        onCroppingChange={onCroppingChange}
        onEditChange={onEditChange}
        onNavigate={onNavigate}
        onClose={onClose}
        onRate={onRate}
      />
    </QueryClientProvider>,
  );
  return { onNavigate, onClose, onRate, onEditChange, onCroppingChange };
}

describe("Loupe keyboard culling", () => {
  it("rates with digit keys and clears with 0", () => {
    const { onRate } = renderLoupe();
    fireEvent.keyDown(window, { key: "3" });
    expect(onRate).toHaveBeenCalledWith("/r/s/DSC00001.ARW", 3);
    fireEvent.keyDown(window, { key: "0" });
    expect(onRate).toHaveBeenCalledWith("/r/s/DSC00001.ARW", 0);
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
    const { onEditChange } = renderLoupe(0, 0.25);
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(onEditChange).toHaveBeenCalledWith(editWith(0.5));
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(onEditChange).toHaveBeenCalledWith(editWith(0));
    fireEvent.keyDown(window, { key: "r" });
    expect(onEditChange).toHaveBeenCalledWith(editWith(0));
  });

  it("clamps exposure at the range ceiling", () => {
    const { onEditChange } = renderLoupe(0, 3);
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(onEditChange).toHaveBeenCalledWith(editWith(3));
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

describe("Loupe crop mode", () => {
  it("swaps the filmstrip for the crop toolbar and pauses culling keys", () => {
    const { onRate, onNavigate, onClose } = renderLoupe(0, 0, true);
    expect(screen.getByTestId("crop-toolbar")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "3" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onRate).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("cancels without touching the edit", () => {
    const { onEditChange, onCroppingChange } = renderLoupe(0, 0, true);
    fireEvent.click(screen.getByTestId("crop-cancel"));
    expect(onCroppingChange).toHaveBeenCalledWith(false);
    expect(onEditChange).not.toHaveBeenCalled();
  });

  it("escape cancels, enter commits", () => {
    const { onEditChange, onCroppingChange } = renderLoupe(0, 0.25, true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCroppingChange).toHaveBeenCalledWith(false);
    fireEvent.keyDown(window, { key: "Enter" });
    // An untouched full-frame draft commits as "no crop".
    expect(onEditChange).toHaveBeenCalledWith({
      ...editWith(0.25),
      crop: null,
      cropAngle: 0,
    });
  });

  it("commits an aspect preset as a real crop", () => {
    const { onEditChange } = renderLoupe(0, 0, true);
    fireEvent.keyDown(screen.getByTestId("crop-aspect"), { key: "Enter" });
    const item = screen.getByTestId("crop-aspect-1:1");
    fireEvent.pointerUp(item);
    fireEvent.click(item);
    fireEvent.click(screen.getByTestId("crop-done"));
    const edit = onEditChange.mock.calls[0][0] as Edit;
    // 3000x2000 test image: a centered square crop is 2000x2000.
    expect(edit.crop?.left).toBeCloseTo(1 / 6);
    expect(edit.crop?.top).toBe(0);
    expect(edit.crop?.right).toBeCloseTo(5 / 6);
    expect(edit.crop?.bottom).toBe(1);
    expect(edit.cropAngle).toBe(0);
  });
});

describe("LoupeSidebar", () => {
  it("shows name, position and stars; rates", () => {
    const onRate = vi.fn();
    render(
      <TooltipProvider>
        <SidebarProvider>
          <LoupeSidebar
            image={makeImages()[1]}
            position={2}
            count={3}
            filmstrip="thumbs"
            onFilmstrip={vi.fn()}
            ratingCounts={[3, 0, 0, 0, 0, 0]}
            ratingOp="gte"
            onRatingOp={vi.fn()}
            ratingStars={0}
            onRatingStars={vi.fn()}
            onRate={onRate}
            onBackToGrid={vi.fn()}
          />
        </SidebarProvider>
      </TooltipProvider>,
    );
    expect(screen.getByTestId("loupe-name").textContent).toBe("DSC00002.ARW");
    expect(screen.getByTestId("loupe-position").textContent).toBe("2/3");

    fireEvent.click(screen.getByTestId("star-4"));
    expect(onRate).toHaveBeenCalledWith("/r/s/DSC00002.ARW", 4);
  });
});

describe("EditSidebar", () => {
  function renderEditSidebar(edit: Edit) {
    const onChange = vi.fn();
    const onClose = vi.fn();
    const onEnterCrop = vi.fn();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <EditSidebar
          image={makeImages()[1]}
          edit={edit}
          onChange={onChange}
          onEnterCrop={onEnterCrop}
          onClose={onClose}
        />
      </QueryClientProvider>,
    );
    return { onChange, onClose, onEnterCrop };
  }

  it("shows the exposure value, resets it, and closes", () => {
    const { onChange, onClose } = renderEditSidebar(editWith(0.25));
    expect(screen.getByText("+0.25")).toBeVisible();
    fireEvent.click(screen.getByTestId("exposure-reset"));
    expect(onChange).toHaveBeenCalledWith(editWith(0));
    fireEvent.click(screen.getByTestId("edit-close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("resets everything at once and keeps identity disabled", () => {
    const { onChange } = renderEditSidebar({
      ...identityEdit,
      exposure: 1,
      shadows: 30,
      curveRGB: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.6 },
        { x: 1, y: 1 },
      ],
    });
    fireEvent.click(screen.getByTestId("edit-reset-all"));
    expect(onChange).toHaveBeenCalledWith(identityEdit);

    cleanup();
    renderEditSidebar(identityEdit);
    expect(screen.getByTestId("edit-reset-all")).toBeDisabled();
  });

  it("enters crop mode from the crop button", () => {
    const { onEnterCrop } = renderEditSidebar(identityEdit);
    fireEvent.click(screen.getByTestId("enter-crop"));
    expect(onEnterCrop).toHaveBeenCalled();
  });

  it("shows every slider and the curve editor", () => {
    renderEditSidebar(identityEdit);
    for (const testid of [
      "exposure",
      "highlights",
      "shadows",
      "temperature",
      "tint",
      "vibrance",
      "saturation",
      "curve-editor",
    ]) {
      expect(screen.getByTestId(testid)).toBeInTheDocument();
    }
  });
});
