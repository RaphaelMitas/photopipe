import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { type ImageFile, identityEdit } from "./core";
import { makeImage } from "./test-image";
import { useCropSession } from "./useCropSession";

it("closing the loupe mid-crop ends the crop, so reopening the photo does not resume it", () => {
  const photo = makeImage("DSC00001.ARW");
  let loupePhoto: ImageFile | null = photo;
  const { result, rerender } = renderHook(() =>
    useCropSession(loupePhoto, identityEdit, vi.fn()),
  );
  act(() => result.current.enter());
  expect(result.current.draft).not.toBeNull();

  loupePhoto = null;
  rerender();
  expect(result.current.draft).toBeNull();

  loupePhoto = photo;
  rerender();
  expect(result.current.draft).toBeNull();
});
