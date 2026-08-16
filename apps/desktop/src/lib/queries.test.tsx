import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Edit, type ImageFile, identityEdit } from "./core";
import { useLibrarySync, usePasteEdits, useSetRating } from "./queries";
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
    mutation.mutate([
      { path: "/r/shoot1/A.ARW", edit: look },
      { path: "/r/shoot1/B.ARW", edit: look },
    ]);

    await waitFor(() => expect(mutation.isSuccess).toBe(true));
    const images = client.getQueryData<ImageFile[]>(["images", "shoot1"]);
    // B goes back on its own; A keeps the optimistic paste, not collateral.
    expect(images?.[0].edit.exposure).toBe(1.5);
    expect(images?.[1].edit.exposure).toBe(0);
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
