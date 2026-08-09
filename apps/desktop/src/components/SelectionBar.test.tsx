import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectionBar } from "./SelectionBar";

afterEach(cleanup);

function renderBar() {
  const handlers = {
    onOpenIn: vi.fn(),
    onExport: vi.fn(),
    onReveal: vi.fn(),
    onDelete: vi.fn(),
    onClear: vi.fn(),
  };
  render(<SelectionBar count={2} appLabel="PureRAW" {...handlers} />);
  return handlers;
}

describe("SelectionBar", () => {
  it("calls handlers with no arguments", () => {
    // Regression: wiring these straight to onClick passes the DOM event as
    // the first argument. Callers take optional params (handoff's `paths`),
    // so the event became data and died in JSON.stringify as a cyclic value.
    const handlers = renderBar();
    for (const [id, handler] of [
      ["action-open-in", handlers.onOpenIn],
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
        onOpenIn={vi.fn()}
        onExport={vi.fn()}
        onReveal={vi.fn()}
        onDelete={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("selection-bar")).toBeNull();
  });

  it("names the remembered app so the button says where files go", () => {
    renderBar();
    expect(screen.getByTestId("action-open-in").textContent).toContain(
      "Open in PureRAW",
    );
  });
});
