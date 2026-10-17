import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Edit, type ImageFile, identityEdit } from "./core";
import {
  useImages,
  useLibrarySync,
  usePasteEdits,
  usePrefetchRender,
  useRender,
  useSetEdit,
  useSetRating,
  useSetRatings,
  useStacking,
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
    expect(progress?.progress).toMatchObject({
      scanning: true,
      filesFound: 100,
      filesEnriched: 40,
    });
  });
});

describe("useLibrarySync refresh", () => {
  it("shows what a rescan found without waiting for the next idle poll", async () => {
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    let generation = 1;
    invoke.mockImplementation(async (_command, { method }) => {
      if (method === "rescan") {
        generation = 2;
        return {};
      }
      return {
        generation,
        root: "/r",
        shoots: 1,
        scanning: false,
        filesFound: 1,
        filesEnriched: 1,
        changedShoots: generation > 1 ? ["shoot1"] : [],
      };
    });

    let sync!: ReturnType<typeof useLibrarySync>;
    function Harness() {
      sync = useLibrarySync(true, 1);
      return null;
    }
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("core_request", {
        method: "status",
        params: { since: 1 },
      }),
    );

    act(() => sync.refresh());
    await waitFor(
      () =>
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: ["images", "shoot1"],
        }),
      { timeout: 1000 },
    );
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
      return { rating: params.rating };
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
          : Promise.resolve({ edit: args.params.edit }),
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

    const gate: Array<() => void> = [];
    const written: string[] = [];
    invoke.mockImplementation(
      (_command, args: { params: { path: string; edit: Edit } }) => {
        written.push(args.params.path);
        return new Promise((resolve) =>
          gate.push(() => resolve({ edit: args.params.edit })),
        );
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
      while (released < gate.length) gate[released++]();
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
      value: { ...identityEdit, exposure: 1 },
    });
    paste.mutate(
      new Map([["/r/shoot1/A.ARW", { ...identityEdit, exposure: 2 }]]),
    );

    await waitFor(() => expect(gate.length).toBe(1));
    gate[0]({ edit: identityEdit });
    await waitFor(() => expect(gate.length).toBe(2));
    gate[1]({ edit: identityEdit });

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
    useRender({ path, mtime: 1, isRaw: path.endsWith(".ARW") }, identityEdit);
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
    const render = (path: string, decoderVersion?: number) => ({
      method: "render",
      params: { path, edit: identityEdit, maxPixel: 2560, decoderVersion },
    });
    expect(invoke).toHaveBeenCalledWith(
      "core_request",
      render("/r/shoot1/A.ARW", 8),
    );
    expect(invoke).toHaveBeenCalledWith(
      "core_request",
      render("/r/shoot1/B.JPG"),
    );
  });

  it("flipping the global decoder requests a fresh raw render", async () => {
    renderHarness(["/r/shoot1/A.ARW"]);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    act(() => setRawDecoderVersion(8));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke).toHaveBeenLastCalledWith("core_request", {
      method: "render",
      params: expect.objectContaining({ decoderVersion: 8 }),
    });
  });
});

describe("usePrefetchRender", () => {
  const next = { path: "/r/shoot1/B.ARW", mtime: 1, isRaw: true };

  function Loupe({ landed }: { landed: boolean }) {
    usePrefetchRender(next, identityEdit);
    return landed ? <Landed /> : null;
  }

  function Landed() {
    const render = useRender(next, identityEdit);
    return render.data ? <p>{render.data}</p> : null;
  }

  async function arrive(landed: boolean) {
    invoke.mockReset();
    let reject: (reason: string) => void = () => {};
    invoke.mockReturnValueOnce(
      new Promise((_, rejectFirst) => {
        reject = rejectFirst;
      }),
    );
    invoke.mockResolvedValue({ cachePath: "/cache/b.jpg" });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, retryDelay: 0 } },
    });
    const view = render(
      <QueryClientProvider client={client}>
        <Loupe landed={false} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    view.rerender(
      <QueryClientProvider client={client}>
        <Loupe landed={landed} />
      </QueryClientProvider>,
    );
    act(() => reject("superseded: dropped for a newer render request"));
    return view;
  }

  it("asks again for a superseded prefetch the loupe landed on mid-flight", async () => {
    const view = await arrive(true);
    expect(await view.findByText("/cache/b.jpg")).toBeTruthy();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("lets a superseded prefetch nobody landed on go", async () => {
    await arrive(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("does not revive a passed photo's retries by prefetching it as a neighbour", async () => {
    const photos = ["A", "B", "C", "D"].map((name) => ({
      path: `/r/shoot1/${name}.ARW`,
      mtime: 1,
      isRaw: true,
    }));
    function Walk({ index }: { index: number }) {
      useRender(photos[index], identityEdit);
      usePrefetchRender(photos[index + 1], identityEdit);
      usePrefetchRender(photos[index - 1], identityEdit);
      return null;
    }
    invoke.mockReset();
    let rejectA: (reason: string) => void = () => {};
    invoke.mockImplementation((_, { params }) =>
      params.path === photos[0].path
        ? new Promise((_, reject) => {
            rejectA = reject;
          })
        : new Promise(() => {}),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retryDelay: 0 } },
    });
    const walk = (index: number) => (
      <QueryClientProvider client={client}>
        <Walk index={index} />
      </QueryClientProvider>
    );
    const view = render(walk(0));
    view.rerender(walk(1));
    view.rerender(walk(2));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(4));

    act(() => rejectA("superseded: dropped for a newer render request"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const requestsForA = invoke.mock.calls.filter(
      ([, { params }]) => params.path === photos[0].path,
    );
    expect(requestsForA).toHaveLength(1);
  });
});

describe("useSetRating", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("takes the core's answer instead of reloading the shoot", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const status = {
      generation: 1,
      root: "/r",
      shoots: 1,
      scanning: true,
      filesFound: 2,
      filesEnriched: 2,
      changedShoots: [],
    };
    invoke.mockImplementation(async (_command, { method, params }) => {
      if (method === "status") return status;
      if (method === "listImages") return { images: [image("A"), image("B")] };
      if (method === "setRating") return { rating: params.rating };
      throw new Error(`unexpected ${method}`);
    });
    const calls = (method: string) =>
      invoke.mock.calls.filter(([, args]) => args.method === method).length;

    let mutation!: ReturnType<typeof useSetRating>;
    function Rater() {
      useImages("shoot1");
      useLibrarySync(true, 1);
      mutation = useSetRating("shoot1");
      return null;
    }
    render(
      <QueryClientProvider client={client}>
        <Rater />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(calls("listImages")).toBe(1));

    await act(() =>
      mutation.mutateAsync({ path: "/r/shoot1/A.ARW", value: 3 }),
    );
    const polled = calls("status");
    await waitFor(() => expect(calls("status")).toBeGreaterThan(polled + 1));

    expect(calls("listImages")).toBe(1);
    expect(
      client.getQueryData<ImageFile[]>(["images", "shoot1"])?.[0].rating,
    ).toBe(3);
  });

  it("still delivers an external change whose refetch a rating cancelled", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const disk = [image("A"), image("B")];
    let generation = 1;
    let listed = 0;
    const held: Array<() => void> = [];
    invoke.mockImplementation(async (_command, { method, params }) => {
      if (method === "status") {
        return {
          generation,
          root: "/r",
          shoots: 1,
          scanning: true,
          filesFound: 2,
          filesEnriched: 2,
          changedShoots: generation > params.since ? ["shoot1"] : [],
        };
      }
      if (method === "listImages") {
        listed += 1;
        if (listed === 2) await new Promise<void>((go) => held.push(go));
        return { images: disk.map((file) => ({ ...file })) };
      }
      if (method === "setRating") {
        disk[0] = { ...disk[0], rating: params.rating };
        return { rating: params.rating };
      }
      throw new Error(`unexpected ${method}`);
    });

    let mutation!: ReturnType<typeof useSetRating>;
    function Rater() {
      useImages("shoot1");
      useLibrarySync(true, 1);
      mutation = useSetRating("shoot1");
      return null;
    }
    render(
      <QueryClientProvider client={client}>
        <Rater />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(listed).toBe(1));

    disk[1] = { ...disk[1], rating: 5 };
    generation = 2;
    await waitFor(() => expect(held.length).toBe(1));
    await act(() =>
      mutation.mutateAsync({ path: "/r/shoot1/A.ARW", value: 3 }),
    );
    held[0]();

    await waitFor(() =>
      expect(
        client
          .getQueryData<ImageFile[]>(["images", "shoot1"])
          ?.map((file) => file.rating),
      ).toEqual([3, 5]),
    );
  });

  it("does not let a list that started before the answer land over it", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let disk = [image("A")];
    const held: Array<() => void> = [];
    invoke.mockImplementation(async (_command, { method, params }) => {
      if (method === "listImages") {
        const snapshot = disk.map((file) => ({ ...file }));
        if (held.length === 1) await new Promise<void>((go) => held.push(go));
        return { images: snapshot };
      }
      if (method === "setRating") {
        await new Promise<void>((go) => held.push(go));
        disk = [{ ...disk[0], rating: params.rating }];
        return { rating: params.rating };
      }
      throw new Error(`unexpected ${method}`);
    });

    let mutation!: ReturnType<typeof useSetRating>;
    function Rater() {
      useImages("shoot1");
      mutation = useSetRating("shoot1");
      return null;
    }
    render(
      <QueryClientProvider client={client}>
        <Rater />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(client.getQueryData(["images", "shoot1"])).toBeDefined(),
    );

    const rated = mutation.mutateAsync({ path: "/r/shoot1/A.ARW", value: 3 });
    await waitFor(() => expect(held.length).toBe(1));
    void client.invalidateQueries({ queryKey: ["images", "shoot1"] });
    await waitFor(() => expect(held.length).toBe(2));
    held[0]();
    await act(() => rated);
    held[1]();

    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(
      client
        .getQueryData<ImageFile[]>(["images", "shoot1"])
        ?.map((file) => file.rating),
    ).toEqual([3]);
  });

  it("refetches a held shoot even when another shoot's batch settles last", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let shoot1 = [image("A"), image("B")];
    client.setQueryData(["images", "shoot2"], [makeImage("C.ARW")]);
    const held: Array<() => void> = [];
    let listed = 0;
    invoke.mockImplementation(async (_command, { method, params }) => {
      if (method === "listImages") {
        listed += 1;
        const snapshot = shoot1.map((file) => ({ ...file }));
        if (listed === 2) await new Promise<void>((go) => held.push(go));
        return { images: snapshot };
      }
      if (method === "setRating" && params.shoot === "shoot2") {
        await new Promise<void>((go) => held.push(go));
      } else if (method === "setRating") {
        shoot1 = [{ ...shoot1[0], rating: params.rating }, shoot1[1]];
      }
      return { rating: params.rating };
    });

    let rate!: ReturnType<typeof useSetRating>;
    let batch!: ReturnType<typeof useSetRatings>;
    function Writers() {
      useImages("shoot1");
      rate = useSetRating("shoot1");
      batch = useSetRatings("shoot2");
      return null;
    }
    render(
      <QueryClientProvider client={client}>
        <Writers />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(listed).toBe(1));

    const batched = batch.mutateAsync(new Map([["/r/s/C.ARW", 4]]));
    await waitFor(() => expect(held.length).toBe(1));
    shoot1 = [shoot1[0], { ...shoot1[1], rating: 5 }];
    void client.invalidateQueries({ queryKey: ["images", "shoot1"] });
    await waitFor(() => expect(held.length).toBe(2));
    await act(() => rate.mutateAsync({ path: "/r/shoot1/A.ARW", value: 3 }));
    held[0]();
    await act(() => batched);

    await waitFor(() =>
      expect(
        client
          .getQueryData<ImageFile[]>(["images", "shoot1"])
          ?.map((file) => file.rating),
      ).toEqual([3, 5]),
    );
  });

  it("shows what is on disk after two failed ratings to one photo", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const refusals: Array<() => void> = [];
    invoke.mockImplementation(async (_command, { method }) => {
      if (method === "listImages") return { images: [image("A")] };
      if (method === "setRating") {
        await new Promise<void>((go) => refusals.push(go));
        throw new Error("read-only card");
      }
      throw new Error(`unexpected ${method}`);
    });

    let mutation!: ReturnType<typeof useSetRating>;
    function Rater() {
      useImages("shoot1");
      mutation = useSetRating("shoot1");
      return null;
    }
    render(
      <QueryClientProvider client={client}>
        <Rater />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(client.getQueryData(["images", "shoot1"])).toBeDefined(),
    );

    const first = mutation.mutateAsync({ path: "/r/shoot1/A.ARW", value: 3 });
    const second = mutation.mutateAsync({ path: "/r/shoot1/A.ARW", value: 4 });
    await waitFor(() => expect(refusals.length).toBe(1));
    refusals[0]();
    await act(() => first.catch(() => {}));
    await waitFor(() => expect(refusals.length).toBe(2));
    refusals[1]();
    await act(() => second.catch(() => {}));

    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(
      client.getQueryData<ImageFile[]>(["images", "shoot1"])?.[0].rating,
    ).toBe(0);
  });

  it("shows what is on disk after two failed batches to one photo", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const refusals: Array<() => void> = [];
    invoke.mockImplementation(async (_command, { method }) => {
      if (method === "listImages") return { images: [image("A")] };
      if (method === "setRating") {
        await new Promise<void>((go) => refusals.push(go));
        throw new Error("read-only card");
      }
      throw new Error(`unexpected ${method}`);
    });

    let batch!: ReturnType<typeof useSetRatings>;
    function Rater() {
      useImages("shoot1");
      batch = useSetRatings("shoot1");
      return null;
    }
    render(
      <QueryClientProvider client={client}>
        <Rater />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(client.getQueryData(["images", "shoot1"])).toBeDefined(),
    );

    const first = batch.mutateAsync(new Map([["/r/shoot1/A.ARW", 3]]));
    const second = batch.mutateAsync(new Map([["/r/shoot1/A.ARW", 4]]));
    let settled = false;
    void Promise.all([first, second]).then(() => {
      settled = true;
    });
    let released = 0;
    await waitFor(() => {
      while (released < refusals.length) refusals[released++]();
      expect(settled).toBe(true);
    });

    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(
      client.getQueryData<ImageFile[]>(["images", "shoot1"])?.[0].rating,
    ).toBe(0);
  });

  it("ends on the last rating when the first answer arrives late", async () => {
    const client = new QueryClient();
    client.setQueryData(["images", "shoot1"], [image("A")]);
    const pending: Array<() => void> = [];
    invoke.mockImplementation(
      (_command, { params }: { params: { rating: number } }) =>
        new Promise((resolve) =>
          pending.push(() => resolve({ rating: params.rating })),
        ),
    );

    let mutation!: ReturnType<typeof useSetRating>;
    function Rater() {
      mutation = useSetRating("shoot1");
      return null;
    }
    render(
      <QueryClientProvider client={client}>
        <Rater />
      </QueryClientProvider>,
    );
    const rating = () =>
      client.getQueryData<ImageFile[]>(["images", "shoot1"])?.[0].rating;

    const first = mutation.mutateAsync({ path: "/r/shoot1/A.ARW", value: 3 });
    const second = mutation.mutateAsync({ path: "/r/shoot1/A.ARW", value: 4 });
    await waitFor(() => expect(pending.length).toBe(1));
    expect(rating()).toBe(4);

    pending[0]();
    await first;
    expect(rating()).toBe(4);

    await waitFor(() => expect(pending.length).toBe(2));
    pending[1]();
    await second;
    expect(rating()).toBe(4);
  });
});

describe("useStacking", () => {
  it("turns on only once every listed photo has been given a stack", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let listed: ImageFile[] = [
      { ...image("a"), stack: "/r/shoot1/a.ARW" },
      image("b"),
    ];
    invoke.mockImplementation(async (_command, { method }) =>
      method === "listImages"
        ? { images: listed }
        : { done: 2, total: 2, running: false },
    );

    let ready = false;
    function Harness() {
      ready = useStacking("s", true).ready;
      return null;
    }
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(client.getQueryData(["images", "s"])).toBeDefined(),
    );
    expect(ready).toBe(false);

    listed = [listed[0], { ...image("b"), stack: "/r/shoot1/b.ARW" }];
    await act(() => client.refetchQueries({ queryKey: ["images", "s"] }));
    await waitFor(() => expect(ready).toBe(true));
  });
});
