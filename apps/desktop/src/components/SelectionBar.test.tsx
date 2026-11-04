import { TooltipProvider } from "@photopipe/ui/components/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeImage } from "@/lib/test-image";
import { SelectionBar } from "./SelectionBar";

afterEach(cleanup);

function renderBar(count = 2, canPaste = true) {
  const client = new QueryClient();
  client.setQueryData(["features"], { trash: true });
  const handlers = {
    onCopySettings: vi.fn(),
    onPasteSettings: vi.fn(),
    onReveal: vi.fn(),
    onDelete: vi.fn(),
    onClear: vi.fn(),
  };
  const selected = Array.from({ length: count }, (_, i) =>
    makeImage(`DSC${i}.ARW`),
  );
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SelectionBar selected={selected} canPaste={canPaste} {...handlers} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return handlers;
}

describe("SelectionBar", () => {
  it("calls handlers with no arguments", () => {
    const handlers = renderBar();
    for (const [id, handler] of [
      ["action-paste-settings", handlers.onPasteSettings],
      ["action-reveal", handlers.onReveal],
      ["action-delete", handlers.onDelete],
      ["action-clear", handlers.onClear],
    ] as const) {
      fireEvent.click(screen.getByTestId(id));
      expect(handler).toHaveBeenCalledWith();
    }
  });

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
