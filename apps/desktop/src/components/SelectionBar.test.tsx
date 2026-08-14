import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectionBar } from "./SelectionBar";

afterEach(cleanup);

function renderBar() {
  const handlers = {
    onExport: vi.fn(),
    onReveal: vi.fn(),
    onDelete: vi.fn(),
    onClear: vi.fn(),
  };
  render(<SelectionBar count={2} {...handlers} />);
  return handlers;
}

describe("SelectionBar", () => {
  it("calls handlers with no arguments", () => {
    const handlers = renderBar();
    for (const [id, handler] of [
      ["action-export", handlers.onExport],
      ["action-reveal", handlers.onReveal],
      ["action-delete", handlers.onDelete],
      ["action-clear", handlers.onClear],
    ] as const) {
      fireEvent.click(screen.getByTestId(id));
      expect(handler).toHaveBeenCalledWith();
    }
  });

  it("stays out of the way when nothing is selected", () => {
    render(
      <SelectionBar
        count={0}
        onExport={vi.fn()}
        onReveal={vi.fn()}
        onDelete={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("selection-bar")).toBeNull();
  });
});
