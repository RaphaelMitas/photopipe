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
  const tree = (paths: string[]) => (
    <QueryClientProvider client={client}>
      <ExportDrawer
        shoot="s"
        rawPaths={paths}
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
    </QueryClientProvider>
  );
  const view = render(tree(rawPaths));
  return {
    onExport,
    rerender: (paths: string[]) => view.rerender(tree(paths)),
  };
}

function mockSupport(raw9: number, rawTotal: number) {
  invoke.mockImplementation(async (_cmd, args: { method?: string }) => {
    if (args.method === "decoderSupport") return { raw9, rawTotal };
    throw `unexpected method ${String(args.method)}`;
  });
}

describe("export decoder row", () => {
  it("stays quiet when culling and exporting agree on RAW 8", async () => {
    localStorage.setItem("photopipe.rawDecoder", "8");
    mockSupport(3, 3);
    renderDrawer();
    await waitFor(() =>
      expect(screen.getByTestId("export-decoder-8")).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    // matching decoders mean the export looks like the previews; the case for
    // RAW 9 belongs in the help text, not an amber warning with no way out
    expect(screen.queryByTestId("decoder-banner")).not.toBeInTheDocument();
    expect(screen.getByTestId("export-decoder-help").textContent).toContain(
      "RAW 9 resolves more detail",
    );
  });

  it("says the exports will be softer when culling on 9 but exporting 8", async () => {
    localStorage.setItem("photopipe.rawDecoder", "9");
    mockSupport(3, 3);
    renderDrawer();
    await waitFor(() =>
      expect(screen.getByTestId("export-decoder-8")).toBeEnabled(),
    );
    expect(screen.queryByTestId("decoder-banner")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("export-decoder-8"));
    expect(screen.getByTestId("decoder-banner")).toHaveTextContent(
      "softer and noisier",
    );
  });

  it("warns the other way when culling on 8 but exporting 9", async () => {
    localStorage.setItem("photopipe.rawDecoder", "8");
    mockSupport(3, 3);
    renderDrawer();
    fireEvent.click(await screen.findByTestId("export-decoder-9"));
    const banner = screen.getByTestId("decoder-banner");
    expect(banner).toHaveTextContent(
      "look different from the RAW 8 previews you culled against",
    );
    expect(banner).toHaveTextContent("Use RAW 8");
  });

  it("stays quiet when culling and exporting agree on RAW 9", async () => {
    localStorage.setItem("photopipe.rawDecoder", "9");
    mockSupport(3, 3);
    const { onExport } = renderDrawer();
    await waitFor(() =>
      expect(screen.getByTestId("export-decoder-9")).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(screen.queryByTestId("decoder-banner")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("run-export"));
    await waitFor(() => expect(onExport).toHaveBeenCalled());
    expect((onExport.mock.calls[0][0] as ExportOptions).decoderVersion).toBe(9);
  });

  it("dismissing holds for that choice and the export keeps it", async () => {
    localStorage.setItem("photopipe.rawDecoder", "9");
    mockSupport(3, 3);
    const { onExport } = renderDrawer();
    await waitFor(() =>
      expect(screen.getByTestId("export-decoder-8")).toBeEnabled(),
    );
    fireEvent.click(screen.getByTestId("export-decoder-8"));
    fireEvent.click(screen.getByTestId("banner-keep"));
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
    // culling sits at 9 here, but the previews fell back to 8 as well, so the
    // export matches what was seen and there is nothing to flag
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

  it("keeps RAW 9 disabled while a new selection is being probed", async () => {
    mockSupport(0, 3);
    const { rerender } = renderDrawer();
    await waitFor(() =>
      expect(screen.getByTestId("export-decoder-9")).toBeDisabled(),
    );
    rerender([...RAWS].reverse());
    expect(screen.getByTestId("export-decoder-9")).toBeDisabled();
  });

  it("does not reuse a dismissal for a different selection", async () => {
    localStorage.setItem("photopipe.rawDecoder", "9");
    mockSupport(3, 3);
    const { rerender } = renderDrawer();
    await waitFor(() =>
      expect(screen.getByTestId("export-decoder-8")).toBeEnabled(),
    );
    fireEvent.click(screen.getByTestId("export-decoder-8"));
    fireEvent.click(screen.getByTestId("banner-keep"));
    expect(screen.queryByTestId("decoder-banner")).not.toBeInTheDocument();

    rerender(["/r/s/D.ARW", "/r/s/E.ARW"]);
    expect(await screen.findByTestId("decoder-banner")).toBeInTheDocument();
  });

  it("asks in batches a slow disk can answer, and sums them", async () => {
    const paths = Array.from({ length: 900 }, (_, i) => `/r/s/${i}.ARW`);
    const sizes: number[] = [];
    invoke.mockImplementation(
      async (
        _cmd,
        args: { method?: string; params?: { paths?: string[] } },
      ) => {
        if (args.method !== "decoderSupport") throw "unexpected";
        const count = args.params?.paths?.length ?? 0;
        sizes.push(count);
        return { raw9: count, rawTotal: count };
      },
    );
    renderDrawer(paths);
    await waitFor(() =>
      expect(screen.getByTestId("export-decoder-help").textContent).toContain(
        "detail",
      ),
    );
    // one 900-path request is what outran the sidecar timeout
    expect(sizes.every((size) => size <= 400)).toBe(true);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(900);
  });

  it("hides the row entirely for a selection with no raws", () => {
    const calls = invoke.mock.calls.length;
    renderDrawer([]);
    expect(screen.queryByTestId("export-decoder-8")).not.toBeInTheDocument();
    expect(invoke.mock.calls.length).toBe(calls);
  });
});
