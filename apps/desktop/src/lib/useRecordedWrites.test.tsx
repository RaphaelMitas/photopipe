import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ImageFile, identityEdit } from "./core";
import { clearHistory, historyState, stepHistory } from "./history";
import { makeImage } from "./test-image";
import { useRecordedWrites } from "./useRecordedWrites";

afterEach(cleanup);

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  convertFileSrc: (path: string) => path,
}));

const PATH = "/r/shoot1/A.ARW";

function setup(image: Partial<ImageFile> = {}) {
  const client = new QueryClient();
  client.setQueryData<ImageFile[]>(
    ["images", "shoot1"],
    [makeImage("A.ARW", { path: PATH, rating: 2, ...image })],
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useRecordedWrites("shoot1"), { wrapper });
}

const written = (method: string) =>
  invoke.mock.calls
    .map(([, args]) => args)
    .filter((args) => args.method === method)
    .map((args) => args.params);

describe("useRecordedWrites", () => {
  beforeEach(() => {
    clearHistory();
    invoke.mockReset();
    invoke.mockResolvedValue({});
  });

  it("records a rating whose undo writes the old one back", async () => {
    const { result } = setup();
    act(() => result.current.rate(PATH, 5));
    await waitFor(() => expect(historyState().cursor).toBe(1));

    await act(() => stepHistory("undo"));
    expect(written("setRating").map((params) => params.rating)).toEqual([5, 2]);
  });

  it("records nothing when the value does not change", async () => {
    const { result } = setup();
    act(() => result.current.rate(PATH, 2));
    act(() => result.current.writeEdit(PATH, { ...identityEdit }));
    await act(() => stepHistory("undo"));
    expect(invoke).not.toHaveBeenCalled();
    expect(historyState().entries).toEqual([]);
  });

  it("writes a rating on an unread photo but cannot promise to undo it", async () => {
    const { result } = setup({ enriched: false });
    act(() => result.current.rate(PATH, 5));
    await waitFor(() => expect(written("setRating")).toHaveLength(1));
    await act(() => stepHistory("undo"));
    expect(historyState().entries).toEqual([]);
  });

  it("names an edit after the setting that moved", async () => {
    const { result } = setup();
    act(() =>
      result.current.writeEdit(PATH, { ...identityEdit, exposure: 0.5 }),
    );
    await waitFor(() => expect(historyState().cursor).toBe(1));
    expect(historyState().entries[0]).toMatchObject({
      label: "Exposure",
      detail: "+0.50",
      paths: [PATH],
    });
  });
});
