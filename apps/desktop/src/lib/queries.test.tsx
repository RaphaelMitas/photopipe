import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Edit, type ImageFile, identityEdit } from "./core";
import {
  useLibrarySync,
  usePasteEdits,
  useRender,
  useSetEdit,
  useSetRating,
  useSetRatings,
} from "./queries";
import { setRawDecoderVersion } from "./rawDecoder";
import { makeImage } from "./test-image";

afterEach(cleanup);

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  convertFileSrc: (path: string) => path,
}));

function image(name: string): ImageFile {
  return makeImage(`${name}.ARW`, { path: `/r/shoot1/${name}.ARW` });
}

function Harness({
  capture,
}: {
  capture: (mutation: ReturnType<typeof useSetRating>) => void;
}) {
  capture(useSetRating("shoot1"));
  return null;
}

describe("useLibrarySync", () => {
  it("refetches only the shoots the core says moved, not every open shoot", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    invoke.mockResolvedValue({
      generation: 7,
      root: "/r",
      shoots: 2,
      scanning: true,
      filesFound: 100,
      filesEnriched: 40,
      changedShoots: ["shoot1"],
    });

    let progress: ReturnType<typeof useLibrarySync> | undefined;
    function Harness() {
      progress = useLibrarySync(true, 1);
      return null;
    }
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["images", "shoot1"],
      }),
    );
    // A blanket ["images"] key would refetch every shoot the app has cached —
    // megabytes per tick on a big library that is still indexing.
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ["images"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["shoots"] });
    expect(progress).toMatchObject({
      scanning: true,
      filesFound: 100,
      filesEnriched: 40,
    });
  });
});

describe("useSetRatings", () => {
  it("rolls back only the photo whose write failed and leaves a hand change alone", async () => {
    const client = new QueryClient();
    client.setQueryData<ImageFile[]>(
      ["images", "shoot1"],
      ["A", "B", "C"].map((name) => ({ ...image(name), rating: 1 })),
    );
    const release: (() => void)[] = [];
    invoke.mockImplementation(async (_command, { params }) => {
      await new Promise<void>((resolve) => release.push(resolve));
      if (params.path.endsWith("B.ARW")) throw new Error("disk");
      return {};
    });
    let ratings!: ReturnType<typeof useSetRatings>;
    function Harness() {
      ratings = useSetRatings("shoot1");
      return null;
    }
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );

    const paths = ["A", "B", "C", "D", "E"].map((n) => `/r/shoot1/${n}.ARW`);
    client.setQueryData<ImageFile[]>(["images", "shoot1"], (old) => [
      ...(old ?? []),
      { ...image("D"), rating: 1 },
      { ...image("E"), rating: 1 },
    ]);
    ratings.mutate(new Map(paths.map((path) => [path, 5])));
    // Four workers hold A to D; E is still queued when it is rated by hand.
    await waitFor(() => expect(release.length).toBe(4));
    client.setQueryData<ImageFile[]>(["images", "shoot1"], (old) =>
      old?.map((img) => (img.path === paths[4] ? { ...img, rating: 2 } : img)),
    );
    for (const go of release) go();

    await waitFor(() => expect(ratings.isSuccess).toBe(true));
    expect(ratings.data).toEqual({
      written: 3,
      failed: [paths[1]],
      overtaken: 1,
    });
    const after = client.getQueryData<ImageFile[]>(["images", "shoot1"]);
    expect(after?.map((img) => img.rating)).toEqual([5, 1, 5, 5, 2]);
  });
});

describe("usePasteEdits", () => {
  it("keeps the pasted look and reverts only the photo whose write failed", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(["images", "shoot1"], [image("A"), image("B")]);
    invoke.mockImplementation(
      (_command, args: { params: { path: string; edit: Edit } }) =>
        args.params.path.endsWith("B.ARW")
          ? Promise.reject("disk full")
          : Promise.resolve({ edit: args.params.edit, generation: 2 }),
    );

    let mutation!: ReturnType<typeof usePasteEdits>;
    function Paste() {
      mutation = usePasteEdits("shoot1");
      return null;
    }
    render(
      <QueryClientProvider client={client}>
        <Paste />
      </QueryClientProvider>,
    );

    const look: Edit = { ...identityEdit, exposure: 1.5 };
    mutation.mutate(
      new Map([
        ["/r/shoot1/A.ARW", look],
        ["/r/shoot1/B.ARW", look],
      ]),
    );

    await waitFor(() => expect(mutation.isSuccess).toBe(true));
    const images = client.getQueryData<ImageFile[]>(["images", "shoot1"]);
    expect(images?.[0].edit.exposure).toBe(1.5);
    expect(images?.[1].edit.exposure).toBe(0);
  });

  it("leaves a photo the user edited while the batch was still queued alone", async () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const last = "/r/shoot1/F.ARW";
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(["images", "shoot1"], names.map(image));

    const gate: Array<(value: unknown) => void> = [];
    const written: string[] = [];
    invoke.mockImplementation(
      (_command, args: { params: { path: string; edit: Edit } }) => {
        written.push(args.params.path);
        return new Promise((resolve) => gate.push(resolve));
      },
    );

    let mutation!: ReturnType<typeof usePasteEdits>;
    function Paste() {
      mutation = usePasteEdits("shoot1");
      return null;
    }
    render(
      <QueryClientProvider client={client}>
        <Paste />
      </QueryClientProvider>,
    );

    const look: Edit = { ...identityEdit, exposure: 1.5 };
    mutation.mutate(
      new Map(names.map((name) => [`/r/shoot1/${name}.ARW`, look])),
    );
    // Four workers, six photos: F is still queued.
    await waitFor(() => expect(written.length).toBe(4));

    client.setQueryData<ImageFile[]>(["images", "shoot1"], (old) =>
      old?.map((file) =>
        file.path === last
          ? { ...file, edit: { ...identityEdit, exposure: -1 } }
          : file,
      ),
    );
    let released = 0;
    await waitFor(() => {
      while (released < gate.length) gate[released++]({ generation: 2 });
      expect(mutation.isSuccess).toBe(true);
    });

    expect(written).not.toContain(last);
    expect(mutation.data?.overtaken).toBe(1);
    expect(mutation.data?.written).toBe(5);
    expect(
      client.getQueryData<ImageFile[]>(["images", "shoot1"])?.[5].edit.exposure,
    ).toBe(-1);
  });
});

describe("edit writes to one photo", () => {
  it("never overlap, so the older value cannot land last", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(["images", "shoot1"], [image("A")]);

    const events: string[] = [];
    const gate: Array<(value: unknown) => void> = [];
    invoke.mockImplementation((_command, args: { params: { edit: Edit } }) => {
      events.push(`start ${args.params.edit.exposure}`);
      return new Promise((resolve) =>
        gate.push((value) => {
          events.push(`end ${args.params.edit.exposure}`);
          resolve(value);
        }),
      );
    });

    let single!: ReturnType<typeof useSetEdit>;
    let paste!: ReturnType<typeof usePasteEdits>;
    function Writers() {
      single = useSetEdit("shoot1");
      paste = usePasteEdits("shoot1");
      return null;
    }
    render(
      <QueryClientProvider client={client}>
        <Writers />
      </QueryClientProvider>,
    );

    single.mutate({
      path: "/r/shoot1/A.ARW",
      edit: { ...identityEdit, exposure: 1 },
    });
    paste.mutate(
      new Map([["/r/shoot1/A.ARW", { ...identityEdit, exposure: 2 }]]),
    );

    await waitFor(() => expect(gate.length).toBe(1));
    gate[0]({ edit: identityEdit, generation: 2 });
    await waitFor(() => expect(gate.length).toBe(2));
    gate[1]({ edit: identityEdit, generation: 3 });

    await waitFor(() => expect(paste.isSuccess).toBe(true));
    expect(events).toEqual(["start 1", "end 1", "start 2", "end 2"]);
  });
});

describe("useRender and the RAW decoder", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({ cachePath: "/cache/x.jpg" });
  });
  afterEach(() => localStorage.clear());

  function RenderOne({ path }: { path: string }) {
    useRender(
      { path, mtime: 1, ext: path.split(".").pop() ?? "" },
      identityEdit,
    );
    return null;
  }

  function renderHarness(paths: string[]) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        {paths.map((path) => (
          <RenderOne key={path} path={path} />
        ))}
      </QueryClientProvider>,
    );
  }

  it("sends the decoder version for raws and never for embedded formats", async () => {
    localStorage.setItem("photopipe.rawDecoder", "8");
    renderHarness(["/r/shoot1/A.ARW", "/r/shoot1/B.JPG"]);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    const params = invoke.mock.calls.map(
      ([, args]) =>
        (args as { params: { path: string; decoderVersion?: number } }).params,
    );
    expect(params.find((p) => p.path.endsWith(".ARW"))?.decoderVersion).toBe(8);
    expect(
      params.find((p) => p.path.endsWith(".JPG"))?.decoderVersion,
    ).toBeUndefined();
  });

  it("flipping the global decoder requests a fresh raw render", async () => {
    renderHarness(["/r/shoot1/A.ARW"]);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    act(() => setRawDecoderVersion(8));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    const last = invoke.mock.calls[1][1] as {
      params: { decoderVersion?: number };
    };
    expect(last.params.decoderVersion).toBe(8);
  });
});

describe("useSetRating burst behavior", () => {
  it("keeps optimistic state through a burst and reconciles exactly once", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(["images", "shoot1"], [image("A"), image("B")]);
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const pending: Array<(value: unknown) => void> = [];
    invoke.mockImplementation(
      () => new Promise((resolve) => pending.push(resolve)),
    );

    let mutation!: ReturnType<typeof useSetRating>;
    render(
      <QueryClientProvider client={client}>
        <Harness
          capture={(m) => {
            mutation = m;
          }}
        />
      </QueryClientProvider>,
    );

    mutation.mutate({ path: "/r/shoot1/A.ARW", rating: 3 });
    mutation.mutate({ path: "/r/shoot1/B.ARW", rating: 4 });
    await waitFor(() => expect(pending.length).toBe(2));

    const optimistic = client.getQueryData<ImageFile[]>(["images", "shoot1"]);
    expect(optimistic?.[0].rating).toBe(3);
    expect(optimistic?.[1].rating).toBe(4);

    pending[0]({ rating: 3, generation: 10 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(
      client.getQueryData<ImageFile[]>(["images", "shoot1"])?.[1].rating,
    ).toBe(4);

    pending[1]({ rating: 4, generation: 11 });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledTimes(1));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["images", "shoot1"],
    });
  });
});
