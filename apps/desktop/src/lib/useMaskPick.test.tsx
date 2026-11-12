import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { type Edit, type ImageFile, identityEdit } from "./core";
import { makeImage } from "./test-image";
import { useMaskPick } from "./useMaskPick";
import { useMaskSession } from "./useMaskSession";

afterEach(cleanup);

const invoke = vi.hoisted(() =>
  vi.fn<(cmd: string, args: { method: string }) => Promise<unknown>>(),
);
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  convertFileSrc: (path: string) => path,
}));

const image = makeImage("a.ARW");

function Photo({
  changeEdit,
}: {
  changeEdit: (image: ImageFile, edit: Edit) => void;
}) {
  const masks = useMaskSession(image, identityEdit, changeEdit, true);
  const pick = useMaskPick(image, identityEdit, masks, () => ({
    x: 0.5,
    y: 0.5,
  }));
  return (
    <>
      <button type="button" onClick={masks.toggleField}>
        field
      </button>
      <button type="button" onClick={pick.onClick} {...pick.photoProps}>
        {pick.crosshair && !pick.busy ? "ready" : "waiting"}
      </button>
    </>
  );
}

it("a click lands while the loupe is open, and is dropped once it has closed", async () => {
  const answers: Array<(pick: unknown) => void> = [];
  invoke.mockImplementation((_, { method }) =>
    method === "maskAt"
      ? new Promise((resolve) => answers.push(resolve))
      : Promise.resolve({ clicks: 16 }),
  );
  const changeEdit = vi.fn();
  const { unmount } = render(
    <QueryClientProvider client={new QueryClient()}>
      <Photo changeEdit={changeEdit} />
    </QueryClientProvider>,
  );
  const click = async () => {
    const photo = await screen.findByText("ready");
    fireEvent.pointerDown(photo, { button: 0 });
    fireEvent.click(photo);
    await waitFor(() => expect(answers).toHaveLength(1));
    return answers.splice(0)[0];
  };
  const point = { x: 0.5, y: 0.5, include: true };
  fireEvent.click(screen.getByText("field"));

  (await click())({ png: "", point });
  await waitFor(() => expect(changeEdit).toHaveBeenCalledTimes(1));

  const late = await click();
  unmount();
  late({ png: "", point });
  await new Promise((resolve) => setTimeout(resolve));
  expect(changeEdit).toHaveBeenCalledTimes(1);
});
