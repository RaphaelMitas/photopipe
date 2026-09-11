import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RootEntry } from "@/lib/roots";
import { RootPicker } from "./RootPicker";

const roots = vi.hoisted(() => ({ list: [] as RootEntry[] }));
vi.mock("@/lib/roots", () => ({
  rootsQuery: { queryKey: ["roots"], queryFn: async () => roots.list },
  forgetRoot: vi.fn(async () => {}),
}));

function renderPicker(props: Partial<Parameters<typeof RootPicker>[0]> = {}) {
  const onPick = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RootPicker onPick={onPick} {...props} />
    </QueryClientProvider>,
  );
  return onPick;
}

afterEach(cleanup);
beforeEach(() => {
  roots.list = [];
});

describe("RootPicker", () => {
  it("reopens an ok root by path and re-picks a broken one via the panel", async () => {
    roots.list = [
      { path: "/v/ok", name: "ok", status: "ok" },
      { path: "/v/broken", name: "broken", status: "broken" },
    ];
    const onPick = renderPicker();
    const entries = await screen.findAllByTestId("recent-root");
    expect(entries).toHaveLength(2);
    expect(entries[1]).toHaveTextContent("choose it again");

    fireEvent.click(entries[0]);
    expect(onPick).toHaveBeenLastCalledWith("/v/ok");
    fireEvent.click(entries[1]);
    expect(onPick).toHaveBeenLastCalledWith(undefined);
  });

  it("greys an unplugged root and asks for the drive", async () => {
    roots.list = [
      { path: "/Volumes/T7/photos", name: "photos", status: "unplugged" },
    ];
    renderPicker();
    const entry = await screen.findByTestId("recent-root");
    expect(entry).toHaveAttribute("data-status", "unplugged");
    expect(entry).toHaveTextContent("connect the drive");
  });

  it("tells the user where to fix a denied folder", () => {
    renderPicker({ error: { kind: "denied", message: "no permission" } });
    expect(screen.getByTestId("root-error")).toHaveTextContent(
      "System Settings > Privacy & Security > Files and Folders",
    );
  });

  it("says a typed path has no folder behind it", () => {
    renderPicker({ error: { kind: "missing", message: "no folder at /x" } });
    expect(screen.getByTestId("root-error")).toHaveTextContent(
      "There is no folder at that path",
    );
  });

  it("explains an unplugged drive and shows other failures verbatim", () => {
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient()}>
        <RootPicker
          onPick={vi.fn()}
          error={{ kind: "unplugged", message: "no such file" }}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("root-error")).toHaveTextContent(
      "Connect the drive",
    );
    unmount();
    renderPicker({ error: { kind: "failed", message: "root_not_found: /x" } });
    expect(screen.getByTestId("root-error")).toHaveTextContent(
      "root_not_found: /x",
    );
  });
});
