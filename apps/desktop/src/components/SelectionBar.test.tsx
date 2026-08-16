import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectionBar } from "./SelectionBar";

afterEach(cleanup);

function renderBar(count = 2, canPaste = true) {
  const handlers = {
    onCopySettings: vi.fn(),
    onPasteSettings: vi.fn(),
    onExport: vi.fn(),
    onReveal: vi.fn(),
    onDelete: vi.fn(),
    onClear: vi.fn(),
  };
  render(<SelectionBar count={count} canPaste={canPaste} {...handlers} />);
  return handlers;
}

describe("SelectionBar", () => {
  it("calls handlers with no arguments", () => {
    const handlers = renderBar();
    for (const [id, handler] of [
      ["action-export", handlers.onExport],
      ["action-paste-settings", handlers.onPasteSettings],
      ["action-reveal", handlers.onReveal],
      ["action-delete", handlers.onDelete],
      ["action-clear", handlers.onClear],
    ] as const) {
      fireEvent.click(screen.getByTestId(id));
      expect(handler).toHaveBeenCalledWith();
    }
  });

  // Copying a look off several photos at once has no meaning; pasting one
  // needs a look on the clipboard.
  it("offers copy on a single photo and paste only with a clipboard", () => {
    renderBar(2, true);
    expect(screen.queryByTestId("action-copy-settings")).toBeNull();
    cleanup();

    renderBar(1, false);
    expect(screen.getByTestId("action-copy-settings")).toBeInTheDocument();
    expect(screen.queryByTestId("action-paste-settings")).toBeNull();
  });

  it("stays out of the way when nothing is selected", () => {
    renderBar(0);
    expect(screen.queryByTestId("selection-bar")).toBeNull();
  });
});
