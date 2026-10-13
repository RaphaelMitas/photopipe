import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  editKey,
  identityEdit,
  isIdentityEdit,
  normalizeImage,
  retryCoreRequest,
} from "./core";
import { makeImage } from "./test-image";

describe("normalizeImage", () => {
  it("fills in the score the core leaves out for an unrated photo", () => {
    // What listImages actually sends: no `score` key at all.
    const { score, ...unrated } = makeImage("DSC00001.ARW");
    expect("score" in unrated).toBe(false);

    expect(normalizeImage(unrated).score).toBeNull();
  });

  it("leaves a real score alone", () => {
    expect(normalizeImage(makeImage("a.arw", { score: 0.4 })).score).toBe(0.4);
    expect(normalizeImage(makeImage("b.arw", { score: 0 })).score).toBe(0);
  });

  it("fills in the tone fields the core omits at their defaults", () => {
    // What listImages actually sends for an untouched photo: the core's
    // encoder drops every field sitting at its default.
    const image = {
      ...makeImage("DSC00002.ARW"),
      edit: { exposure: 0, highlights: 0, shadows: 0 },
    };

    const edit = normalizeImage(image).edit;
    expect(edit.whites).toBe(0);
    expect(edit.blacks).toBe(0);
    expect(edit.dehaze).toBe(0);
    expect(edit.curveRGB).toEqual([]);
    expect(isIdentityEdit(edit)).toBe(true);
    expect(editKey(edit)).toBe(editKey(identityEdit));
  });

  it("keeps the values the core did send", () => {
    const image = makeImage("DSC00003.ARW", {
      edit: { ...identityEdit, whites: 40, blacks: -15 },
    });

    const edit = normalizeImage(image).edit;
    expect(edit.whites).toBe(40);
    expect(edit.blacks).toBe(-15);
    expect(isIdentityEdit(edit)).toBe(false);
  });
});

describe("retryCoreRequest", () => {
  async function attempts(rejection: string) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: retryCoreRequest, retryDelay: 0 } },
    });
    const queryFn = vi.fn().mockRejectedValue(rejection);
    await client.fetchQuery({ queryKey: ["x"], queryFn }).catch(() => {});
    return queryFn.mock.calls.length;
  }

  it("does not ask again for a request the core superseded", async () => {
    expect(
      await attempts("superseded: dropped for a newer render request"),
    ).toBe(1);
  });

  it("still retries other failures", async () => {
    expect(await attempts("sidecar did not answer within 10s")).toBe(4);
  });
});
