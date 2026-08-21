import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportDrawer, type ExportOptions } from "./ExportDrawer";

afterEach(cleanup);
afterEach(() => localStorage.clear());

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => "/fake/delivery"),
  save: vi.fn(async () => "/fake/delivery.zip"),
}));

const RAWS = ["/r/s/A.ARW", "/r/s/B.ARW", "/r/s/C.ARW"];

function renderDrawer(rawPaths: string[] = RAWS) {
  const onExport = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ExportDrawer
        shoot="s"
        rawPaths={rawPaths}
        selectedCount={rawPaths.length || 1}
        editedCount={0}
        filteredCount={3}
        totalCount={3}
        filterActive={false}
        jobs={[]}
        busy={false}
        onSelectFiltered={vi.fn()}
        onSelectAll={vi.fn()}
        onClearSelection={vi.fn()}
        onExport={onExport}
        onCancel={vi.fn()}
        onReveal={vi.fn()}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { onExport };
}

function mockSupport(raw9: number, rawTotal: number) {
  invoke.mockImplementation(async (_cmd, args: { method?: string }) => {
    if (args.method === "decoderSupport") return { raw9, rawTotal };
    throw `unexpected method ${String(args.method)}`;
  });
}

describe("export decoder row", () => {
  it("warns when culling on RAW 8, and Use RAW 9 clears it", async () => {
    localStorage.setItem("photopipe.rawDecoder", "8");
    mockSupport(3, 3);
    renderDrawer();
    const banner = await screen.findByTestId("decoder-banner");
    expect(banner).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("banner-use-raw9"));
    expect(screen.queryByTestId("decoder-banner")).not.toBeInTheDocument();
    expect(screen.getByTestId("export-decoder-9")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("Keep RAW 8 dismisses the warning and the export stays RAW 8", async () => {
    localStorage.setItem("photopipe.rawDecoder", "8");
    mockSupport(3, 3);
    const { onExport } = renderDrawer();
    fireEvent.click(await screen.findByTestId("banner-keep-raw8"));
    expect(screen.queryByTestId("decoder-banner")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("run-export"));
    await waitFor(() => expect(onExport).toHaveBeenCalled());
    const options = onExport.mock.calls[0][0] as ExportOptions;
    expect(options.decoderVersion).toBe(8);
  });

  it("says how far RAW 9 reaches on a mixed selection", async () => {
    mockSupport(2, 3);
    renderDrawer();
    await waitFor(() =>
      expect(screen.getByTestId("export-decoder-help").textContent).toContain(
        "2 of 3",
      ),
    );
    expect(screen.queryByTestId("decoder-banner")).not.toBeInTheDocument();
  });

  it("disables RAW 9 and never warns when nothing supports it", async () => {
    mockSupport(0, 3);
    const { onExport } = renderDrawer();
    await waitFor(() =>
      expect(screen.getByTestId("export-decoder-9")).toBeDisabled(),
    );
    expect(screen.getByTestId("export-decoder-help").textContent).toContain(
      "isn't available for these photos on this Mac",
    );
    expect(screen.queryByTestId("decoder-banner")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("run-export"));
    await waitFor(() => expect(onExport).toHaveBeenCalled());
    expect((onExport.mock.calls[0][0] as ExportOptions).decoderVersion).toBe(8);
  });

  it("hides the row entirely for a selection with no raws", () => {
    const calls = invoke.mock.calls.length;
    renderDrawer([]);
    expect(screen.queryByTestId("export-decoder-8")).not.toBeInTheDocument();
    expect(invoke.mock.calls.length).toBe(calls);
  });
});
