import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImageFile } from "@/lib/core";
import { makeImage } from "@/lib/test-image";
import {
  decodeOptions,
  ExportDrawer,
  type ExportOptions,
} from "./ExportDrawer";

afterEach(cleanup);
afterEach(() => localStorage.clear());

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(async () => "/fake/delivery.zip"),
}));

function nonCoreAnswer(cmd: string) {
  if (cmd === "features") return { updater: false, zipExport: true };
  if (cmd === "pick_folder") return "/fake/delivery";
  return undefined;
}

const RAWS = ["/r/s/A.ARW", "/r/s/B.ARW", "/r/s/C.ARW"];

const imagesAt = (paths: string[]): ImageFile[] =>
  paths.map((path) => makeImage(path.replace("/r/s/", ""), { path }));

function renderDrawer(rawPaths: string[] = RAWS) {
  const onExport =
    vi.fn<(options: ExportOptions, destination: string) => void>();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const tree = (paths: string[]) => (
    <QueryClientProvider client={client}>
      <ExportDrawer
        shoot="s"
        images={imagesAt(paths)}
        sort="name"
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
  invoke.mockImplementation(async (cmd: string, args?: { method?: string }) => {
    const answer = nonCoreAnswer(cmd);
    if (answer !== undefined) return answer;
    if (args?.method === "decoderSupport") return { raw9, rawTotal };
    throw `unexpected ${cmd} ${String(args?.method)}`;
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
    expect(onExport.mock.calls[0][0].decoderVersion).toBe(9);
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
    const options = onExport.mock.calls[0][0];
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
      "isn't available for these photos.",
    );
    expect(screen.queryByTestId("decoder-banner")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("run-export"));
    await waitFor(() => expect(onExport).toHaveBeenCalled());
    expect(onExport.mock.calls[0][0].decoderVersion).toBe(8);
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
        cmd: string,
        args?: { method?: string; params?: { paths?: string[] } },
      ) => {
        const answer = nonCoreAnswer(cmd);
        if (answer !== undefined) return answer;
        if (args?.method !== "decoderSupport") throw "unexpected";
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
    // one 900-path request is what outran the request timeout
    expect(sizes.every((size) => size <= 400)).toBe(true);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(900);
  });

  it("hides the row entirely for a selection with no raws", () => {
    const coreCalls = () =>
      invoke.mock.calls.filter(([cmd]) => cmd === "core_request").length;
    const calls = coreCalls();
    renderDrawer([]);
    expect(screen.queryByTestId("export-decoder-8")).not.toBeInTheDocument();
    expect(coreCalls()).toBe(calls);
  });
});

describe("export size", () => {
  it("loads options saved before the size existed at full size", () => {
    const old = JSON.stringify({ format: "jpeg", quality: 100, zip: true });
    expect(decodeOptions(old)).toEqual({
      format: "jpeg",
      quality: 100,
      size: "full",
      customLongEdge: 4096,
      zip: true,
      flatten: true,
      rename: false,
      template: "{date}_{shoot}_{seq}",
      recentTemplates: [],
    });
  });

  it("keeps a size and custom edge it can export, and drops the rest", () => {
    const stored = (size: unknown, customLongEdge: unknown) =>
      decodeOptions(JSON.stringify({ format: "jpeg", size, customLongEdge }));
    expect(stored("2048", 1600)).toMatchObject({
      size: "2048",
      customLongEdge: 1600,
    });
    expect(stored("custom", 1600).size).toBe("custom");
    expect(stored("custom", 256).customLongEdge).toBe(256);
    expect(stored("custom", 16384).customLongEdge).toBe(16384);
    expect(stored(2048, 1600).size).toBe("full");
    expect(stored("4096", 1600).size).toBe("full");
    for (const junk of [100, 99999, 1600.5, "1600", null]) {
      expect(stored("custom", junk).customLongEdge).toBe(4096);
    }
    expect(decodeOptions("{not json").size).toBe("full");
  });

  it("hands the picked size to the export", async () => {
    mockSupport(0, 3);
    const { onExport } = renderDrawer();
    fireEvent.click(screen.getByTestId("format-jpeg"));
    fireEvent.click(screen.getByTestId("size-2048"));
    expect(screen.getByTestId("size-2048")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() => expect(screen.getByTestId("run-export")).toBeEnabled());
    fireEvent.click(screen.getByTestId("run-export"));
    await waitFor(() => expect(onExport).toHaveBeenCalled());
    expect(onExport.mock.calls[0][0].longEdge).toBe(2048);
  });

  it("saves the custom edge once it is left, clamped to what it can export", async () => {
    mockSupport(0, 3);
    const { onExport } = renderDrawer();
    fireEvent.click(screen.getByTestId("format-jpeg"));
    fireEvent.click(screen.getByTestId("size-custom"));
    const field = screen.getByTestId("custom-long-edge");
    // backspacing 4096 away passes 409, which must not stick
    for (const typed of ["409", "40", ""]) {
      fireEvent.change(field, { target: { value: typed } });
    }
    fireEvent.blur(field);
    expect(field).toHaveValue("4096");
    for (const typed of ["1", "16", "160", "1600"]) {
      fireEvent.change(field, { target: { value: typed } });
    }
    fireEvent.blur(field);
    expect(field).toHaveValue("1600");
    fireEvent.change(field, { target: { value: "20000" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(field).toHaveValue("16384");
    for (const junk of ["", "abc"]) {
      fireEvent.change(field, { target: { value: junk } });
      fireEvent.blur(field);
      expect(field).toHaveValue("16384");
    }
    await waitFor(() => expect(screen.getByTestId("run-export")).toBeEnabled());
    fireEvent.click(screen.getByTestId("run-export"));
    await waitFor(() => expect(onExport).toHaveBeenCalled());
    expect(onExport.mock.calls[0][0].longEdge).toBe(16384);
  });
});

describe("export names", () => {
  it("sends one name per photo in grid order and remembers a custom template", async () => {
    mockSupport(0, 3);
    const { onExport } = renderDrawer();
    fireEvent.click(screen.getByTestId("rename"));
    fireEvent.change(screen.getByTestId("name-template"), {
      target: { value: "show_{seq}_{original}" },
    });
    expect(screen.getByTestId("name-preview")).toHaveTextContent(
      "show_001_A.jpg",
    );
    await waitFor(() => expect(screen.getByTestId("run-export")).toBeEnabled());
    fireEvent.click(screen.getByTestId("run-export"));
    await waitFor(() => expect(onExport).toHaveBeenCalled());
    expect(onExport.mock.calls[0][0].names).toEqual([
      "show_001_A",
      "show_002_B",
      "show_003_C",
    ]);
    expect(
      decodeOptions(localStorage.getItem("photopipe.export")).recentTemplates,
    ).toEqual(["show_{seq}_{original}"]);
  });

  it("blocks the export on a token it does not know", async () => {
    mockSupport(0, 3);
    const { onExport } = renderDrawer();
    fireEvent.click(screen.getByTestId("rename"));
    fireEvent.change(screen.getByTestId("name-template"), {
      target: { value: "{stars}_{seq}" },
    });
    expect(screen.getByTestId("name-problem")).toHaveTextContent(
      "{stars} isn't a token",
    );
    expect(screen.getByTestId("run-export")).toBeDisabled();
    fireEvent.click(screen.getByTestId("rename"));
    await waitFor(() => expect(screen.getByTestId("run-export")).toBeEnabled());
    fireEvent.click(screen.getByTestId("run-export"));
    await waitFor(() => expect(onExport).toHaveBeenCalled());
    expect(onExport.mock.calls[0][0].names).toBeNull();
  });
});
