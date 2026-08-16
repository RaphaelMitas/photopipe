import { SidebarProvider } from "@photopipe/ui/components/sidebar";
import { TooltipProvider } from "@photopipe/ui/components/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Edit, type ImageFile, identityEdit } from "@/lib/core";
import { makeImage } from "@/lib/test-image";
import { type CropDraft, draftFromEdit } from "./CropTool";
import { EditSidebar } from "./EditPanel";
import { Loupe } from "./Loupe";
import { LoupeSidebar } from "./LoupeSidebar";

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

function renderLoupe(
  index = 0,
  exposure = 0,
  cropDraft: CropDraft | null = null,
) {
  const onNavigate = vi.fn();
  const onClose = vi.fn();
  const onRate = vi.fn();
  const onEditChange = vi.fn();
  const onCropDraft = vi.fn();
  const onApplyCrop = vi.fn();
  const onCancelCrop = vi.fn();
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
        cropDraft={cropDraft}
        onCropDraft={onCropDraft}
        onApplyCrop={onApplyCrop}
        onCancelCrop={onCancelCrop}
        onEditChange={onEditChange}
        onNavigate={onNavigate}
        onClose={onClose}
        onRate={onRate}
      />
    </QueryClientProvider>,
  );
  return {
    onNavigate,
    onClose,
    onRate,
    onEditChange,
    onCropDraft,
    onApplyCrop,
    onCancelCrop,
  };
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
  const draft = () => draftFromEdit(identityEdit);

  it("shows the overlay and angle HUD and pauses culling keys", () => {
    const { onRate, onNavigate, onClose } = renderLoupe(0, 0, draft());
    expect(screen.getByTestId("crop-angle-hud")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "3" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onRate).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("escape cancels, enter applies", () => {
    const { onApplyCrop, onCancelCrop, onEditChange } = renderLoupe(
      0,
      0.25,
      draft(),
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancelCrop).toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onApplyCrop).toHaveBeenCalled();
    expect(onEditChange).not.toHaveBeenCalled();
  });

  it("double-clicking the stage resets the angle only", () => {
    const angled = { ...draft(), angle: 3.5 };
    const { onCropDraft } = renderLoupe(0, 0, angled);
    expect(screen.getByTestId("crop-angle-hud").textContent).toContain("+3.5°");
    const stage = screen.getByTestId("loupe").firstElementChild;
    if (!stage) throw new Error("no stage");
    fireEvent.doubleClick(stage);
    expect(onCropDraft).toHaveBeenCalledWith({ ...angled, angle: 0 });
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
            betterThan={null}
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

  function renderSidebar(image: ImageFile, betterThan: number | null) {
    render(
      <TooltipProvider>
        <SidebarProvider>
          <LoupeSidebar
            image={image}
            position={2}
            count={3}
            betterThan={betterThan}
            filmstrip="thumbs"
            onFilmstrip={vi.fn()}
            ratingCounts={[3, 0, 0, 0, 0, 0]}
            ratingOp="gte"
            onRatingOp={vi.fn()}
            ratingStars={0}
            onRatingStars={vi.fn()}
            onRate={vi.fn()}
            onBackToGrid={vi.fn()}
          />
        </SidebarProvider>
      </TooltipProvider>,
    );
  }

  it("shows the Instinct score out of 100 and where it stands", () => {
    renderSidebar(makeImage("DSC00002.ARW", { score: 0.739 }), 95);
    const instinct = screen.getByTestId("instinct");
    expect(instinct).toHaveTextContent("Instinct");
    expect(instinct).toHaveTextContent("87");
    expect(instinct).toHaveTextContent("higher than 95% of this project");
  });

  it("says nothing about Instinct for a photo it could not rate", () => {
    renderSidebar(makeImage("DSC00002.ARW", { score: null }), null);
    expect(screen.queryByTestId("instinct")).not.toBeInTheDocument();
  });
});

describe("EditSidebar", () => {
  function renderEditSidebar(edit: Edit, cropDraft: CropDraft | null = null) {
    const onChange = vi.fn();
    const onClose = vi.fn();
    const onEnterCrop = vi.fn();
    const onCropDraft = vi.fn();
    const onApplyCrop = vi.fn();
    const onCancelCrop = vi.fn();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <EditSidebar
          image={makeImages()[1]}
          edit={edit}
          onChange={onChange}
          cropDraft={cropDraft}
          onCropDraft={onCropDraft}
          onEnterCrop={onEnterCrop}
          onApplyCrop={onApplyCrop}
          onCancelCrop={onCancelCrop}
          canPaste={false}
          onCopySettings={vi.fn()}
          onPasteSettings={vi.fn()}
          onClose={onClose}
        />
      </QueryClientProvider>,
    );
    return {
      onChange,
      onClose,
      onEnterCrop,
      onCropDraft,
      onApplyCrop,
      onCancelCrop,
    };
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

  it("shows the crop panel while cropping and wires apply and cancel", () => {
    const draft = draftFromEdit(identityEdit);
    const { onApplyCrop, onCancelCrop } = renderEditSidebar(
      identityEdit,
      draft,
    );
    expect(screen.getByTestId("crop-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("enter-crop")).not.toBeInTheDocument();
    expect(screen.getByTestId("edit-reset-all")).toBeDisabled();
    expect(screen.getByTestId("edit-close")).toBeDisabled();
    fireEvent.click(screen.getByTestId("crop-apply"));
    expect(onApplyCrop).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("crop-cancel"));
    expect(onCancelCrop).toHaveBeenCalled();
  });

  it("picking a ratio applies a centered aspect crop", () => {
    const draft = draftFromEdit(identityEdit);
    const { onCropDraft } = renderEditSidebar(identityEdit, draft);
    fireEvent.change(screen.getByTestId("crop-aspect"), {
      target: { value: "1:1" },
    });
    const next = onCropDraft.mock.calls[0][0];
    expect(next.aspect).toBe("1:1");
    // 3000x2000 test image: a centered square crop is 2000x2000.
    expect(next.crop.left).toBeCloseTo(1 / 6);
    expect(next.crop.right).toBeCloseTo(5 / 6);
    expect(next.crop.top).toBeCloseTo(0);
    expect(next.crop.bottom).toBeCloseTo(1);
  });

  it("turn 90° rotates the draft and carries the crop along", () => {
    const draft = {
      ...draftFromEdit(identityEdit),
      crop: { left: 0, top: 0, right: 0.5, bottom: 1 },
    };
    const { onCropDraft } = renderEditSidebar(identityEdit, draft);
    fireEvent.click(screen.getByTestId("crop-turn"));
    expect(onCropDraft).toHaveBeenCalledWith({
      ...draft,
      rotation: 90,
      // The left half of the frame becomes the top half after a clockwise
      // turn. "free" has no ratio lock, so flipped stays put.
      crop: { left: 0, top: 0, right: 1, bottom: 0.5 },
    });
  });

  it("turn 90° flips the lock only for fixed ratio presets", () => {
    const preset = {
      ...draftFromEdit(identityEdit),
      aspect: "16:9",
      crop: { left: 0.2, top: 0.2, right: 0.8, bottom: 0.8 },
    };
    const first = renderEditSidebar(identityEdit, preset);
    fireEvent.click(screen.getByTestId("crop-turn"));
    expect(first.onCropDraft.mock.calls[0][0].flipped).toBe(true);
    cleanup();
    // original/transposed follow the turned frame dims by themselves; a
    // flip on top would invert the lock against the turned rect.
    const original = { ...preset, aspect: "original" };
    const second = renderEditSidebar(identityEdit, original);
    fireEvent.click(screen.getByTestId("crop-turn"));
    expect(second.onCropDraft.mock.calls[0][0].flipped).toBe(false);
  });

  it("the flip button transposes the crop about its center", () => {
    // 3000x2000 image: a centered 1500x1000px crop transposes to 1000x1500px.
    const draft = {
      ...draftFromEdit(identityEdit),
      crop: { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 },
    };
    const { onCropDraft } = renderEditSidebar(identityEdit, draft);
    fireEvent.click(screen.getByTestId("crop-flip"));
    const next = onCropDraft.mock.calls[0][0];
    expect(next.flipped).toBe(true);
    expect((next.crop.right - next.crop.left) * 3000).toBeCloseTo(1000);
    expect((next.crop.bottom - next.crop.top) * 2000).toBeCloseTo(1500);
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
