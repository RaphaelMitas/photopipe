import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ImageFile, identityEdit } from "./core";
import { useSetRating } from "./queries";

afterEach(cleanup);

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  convertFileSrc: (path: string) => path,
}));

function image(name: string): ImageFile {
  return {
    path: `/r/shoot1/${name}.ARW`,
    rel: `${name}.ARW`,
    ext: "ARW",
    size: 1,
    mtime: 1,
    rating: 0,
    edit: identityEdit,
    width: 3000,
    height: 2000,
  };
}

function Harness({
  capture,
}: {
  capture: (mutation: ReturnType<typeof useSetRating>) => void;
}) {
  capture(useSetRating("shoot1"));
  return null;
}

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
