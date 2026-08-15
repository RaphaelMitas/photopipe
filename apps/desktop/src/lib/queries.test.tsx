import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImageFile } from "./core";
import { useLibrarySync, useSetRating } from "./queries";
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
    expect(progress).toEqual({ scanning: true, found: 100, enriched: 40 });
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
