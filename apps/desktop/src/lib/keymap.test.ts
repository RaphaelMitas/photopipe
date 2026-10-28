import { describe, expect, it } from "vitest";
import { chordsOf, formatChord, isChord } from "./keymap";

const press = (key: string, code: string, held: Partial<KeyboardEvent> = {}) =>
  chordsOf({
    key,
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...held,
  });

describe("chordsOf", () => {
  it("reads letters by character, so QWERTZ's Z is Z", () => {
    expect(press("z", "KeyY", { metaKey: true })).toEqual(["meta+z"]);
    expect(press("P", "KeyP", { shiftKey: true })).toEqual(["shift+p"]);
  });

  it("keeps ⇧ on letters beyond ASCII, so ⇧ü is not ü", () => {
    expect(press("Ü", "BracketLeft", { shiftKey: true })).toEqual(["shift+ü"]);
    expect(press("ø", "KeyO", { altKey: true })).toEqual(["alt+o"]);
  });

  it("reads digits by position, so ⇧1 is not !", () => {
    expect(press("!", "Digit1", { shiftKey: true })[0]).toBe("shift+1");
    expect(press("4", "Numpad4")).toEqual(["4"]);
  });

  it("recovers the letter ⌥ turned into a symbol", () => {
    expect(press("≈", "KeyX", { altKey: true })).toEqual(["alt+x"]);
  });

  it("also reads the symbol a German Mac types with ⇧ or ⌥", () => {
    expect(press("/", "Digit7", { metaKey: true, shiftKey: true })).toEqual([
      "shift+meta+7",
      "meta+/",
    ]);
    expect(press("\\", "Digit7", { altKey: true, shiftKey: true })).toContain(
      "\\",
    );
    expect(press("?", "Minus", { shiftKey: true })).toEqual(["?"]);
  });

  it("ignores a lone modifier", () => {
    expect(press("Shift", "ShiftLeft", { shiftKey: true })).toEqual([]);
  });
});

describe("chords", () => {
  it("formats in Apple's modifier order", () => {
    expect(formatChord("shift+meta+z")).toBe("⇧⌘Z");
    expect(formatChord("arrowleft")).toBe("←");
    expect(formatChord("meta++")).toBe("⌘+");
    expect(formatChord("ß")).toBe("ß");
  });

  it("rejects stored values that are not a key", () => {
    expect(isChord("meta+c")).toBe(true);
    expect(isChord("meta++")).toBe(true);
    expect(isChord("")).toBe(false);
    expect(isChord("meta+")).toBe(false);
  });
});
