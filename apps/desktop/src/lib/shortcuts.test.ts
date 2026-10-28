import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTION_IDS, ACTIONS, type Context } from "./keymap";
import {
  assignShortcut,
  bindingsOf,
  releaseEscape,
  resetAllShortcuts,
  resetShortcut,
  useShortcutContext,
  useShortcuts,
} from "./shortcuts";

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetAllShortcuts();
});

describe("rebinding", () => {
  it("swaps a key with the action that had it, and forgets a return to default", () => {
    assignShortcut("flag.pick", "p", ["x"]);
    expect(bindingsOf("flag.pick")).toEqual(["x"]);
    expect(bindingsOf("flag.reject")).toEqual(["p"]);
    assignShortcut("flag.pick", "x", ["p"]);
    expect(localStorage.getItem("photopipe.shortcuts")).toBe("{}");
  });

  it("only takes a key from actions that can fire in the same place", () => {
    assignShortcut("select.clear", null, ["e"]);
    expect(bindingsOf("editPanel.toggle")).toEqual(["e"]);
  });

  it("takes a key from every action it would collide with", () => {
    assignShortcut("flag.clear", "u", ["escape"]);
    expect(bindingsOf("select.clear")).toEqual(["u"]);
    expect(bindingsOf("loupe.close")).toEqual(["u"]);
  });

  it("only hands a key back where it collides with nothing", () => {
    assignShortcut("crop.cancel", "escape", ["meta+b"]);
    expect(bindingsOf("sidebar.toggle")).toEqual([]);
  });

  it("frees every chord the press makes, so ⌘⇧7 on a German Mac takes ⌘/", () => {
    assignShortcut("export.open", "meta+e", ["shift+meta+7", "meta+/"]);
    expect(bindingsOf("export.open")).toEqual(["shift+meta+7"]);
    expect(bindingsOf("app.shortcuts")).toEqual(["meta+e"]);
  });

  it("ships defaults where no key fires two actions", () => {
    const fired = ACTION_IDS.flatMap((id) =>
      ACTIONS[id].contexts.flatMap((context) =>
        ACTIONS[id].keys.map((key) => `${context} ${key}`),
      ),
    );
    expect(fired.length).toBe(new Set(fired).size);
  });

  it("keeps ⌘/ when a German Mac records it again as ⌘⇧7", () => {
    assignShortcut("app.shortcuts", "meta+/", ["shift+meta+7", "meta+/"]);
    expect(localStorage.getItem("photopipe.shortcuts")).toBe("{}");
  });

  it("undoes a swap on reset, giving the other action its key back", () => {
    assignShortcut("flag.pick", "p", ["x"]);
    resetShortcut("flag.pick");
    expect(bindingsOf("flag.pick")).toEqual(["p"]);
    expect(bindingsOf("flag.reject")).toEqual(["x"]);
  });

  it("puts whoever loses a key on reset back on its own default", () => {
    assignShortcut("flag.pick", "p", ["k"]);
    assignShortcut("stacks.toggle", "s", ["p"]);
    resetShortcut("flag.pick");
    expect(bindingsOf("stacks.toggle")).toEqual(["s"]);
  });

  it("does nothing when a key is recorded over itself", () => {
    const germanSlash = ["shift+meta+7", "meta+/"];
    assignShortcut("history.show", "meta+y", germanSlash);
    resetShortcut("app.shortcuts");
    assignShortcut("history.show", "shift+meta+7", germanSlash);
    expect(bindingsOf("history.show")).toEqual(["shift+meta+7"]);
    expect(bindingsOf("app.shortcuts")).toEqual(["meta+/"]);
  });

  it("takes its keys back on reset", () => {
    assignShortcut("rate.0", null, ["p"]);
    resetShortcut("flag.pick");
    expect(bindingsOf("flag.pick")).toEqual(["p"]);
    expect(bindingsOf("rate.0")).toEqual(["0"]);
  });

  it("falls back to defaults for stored junk", () => {
    localStorage.setItem(
      "photopipe.shortcuts",
      JSON.stringify({
        "flag.pick": ["t", 3],
        "app.settings": ["q"],
        gone: [],
      }),
    );
    expect(bindingsOf("flag.pick")).toEqual(["p"]);
    expect(bindingsOf("app.settings")).toEqual(["meta+,"]);
    localStorage.setItem(
      "photopipe.shortcuts",
      JSON.stringify({ "export.open": ["meta+w"], "flag.pick": ["t", "t"] }),
    );
    expect(bindingsOf("export.open")).toEqual(["meta+e"]);
    expect(bindingsOf("flag.pick")).toEqual(["t"]);
  });
});

function mount(context: Context, handlers: Parameters<typeof useShortcuts>[0]) {
  return renderHook(() => {
    useShortcutContext(context);
    useShortcuts(handlers);
  });
}

function escapeThroughTooltip() {
  const tooltip = (event: KeyboardEvent) => {
    releaseEscape(event);
    event.preventDefault();
  };
  document.addEventListener("keydown", tooltip, { capture: true });
  fireEvent.keyDown(document.body, { key: "Escape" });
  document.removeEventListener("keydown", tooltip, { capture: true });
}

describe("dispatch", () => {
  it("runs the action bound in the active context", () => {
    const pick = vi.fn();
    mount("loupe", { "flag.pick": pick });
    fireEvent.keyDown(window, { key: "p" });
    expect(pick).toHaveBeenCalledOnce();
  });

  it("lets the crop own Escape while it is open", () => {
    const close = vi.fn();
    const cancel = vi.fn();
    mount("loupe", { "loupe.close": close });
    const crop = mount("crop", { "crop.cancel": cancel });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(cancel).toHaveBeenCalledOnce();
    crop.unmount();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("follows a rebind without remounting", () => {
    const pick = vi.fn();
    mount("loupe", { "flag.pick": pick });
    act(() => assignShortcut("flag.pick", "p", ["t"]));
    fireEvent.keyDown(window, { key: "p" });
    fireEvent.keyDown(window, { key: "t" });
    expect(pick).toHaveBeenCalledOnce();
  });

  it("leaves a key alone while typing or held down", () => {
    const pick = vi.fn();
    mount("loupe", { "flag.pick": pick });
    const input = document.body.appendChild(document.createElement("input"));
    fireEvent.keyDown(input, { key: "p" });
    fireEvent.keyDown(window, { key: "p", repeat: true });
    input.remove();
    expect(pick).not.toHaveBeenCalled();
  });

  it("swallows a held key so it can't fall through to the menu", () => {
    const selectAll = vi.fn();
    mount("browser", { "select.all": selectAll });
    expect(
      fireEvent.keyDown(window, { key: "a", metaKey: true, repeat: true }),
    ).toBe(false);
    expect(selectAll).not.toHaveBeenCalled();
  });

  it("passes on a key the handler declines", () => {
    mount("browser", { "select.clear": () => false });
    expect(fireEvent.keyDown(window, { key: "Escape" })).toBe(true);
  });

  it("still gets an Escape a tooltip spent on closing itself", () => {
    const close = vi.fn();
    mount("loupe", { "loupe.close": close });
    escapeThroughTooltip();
    expect(close).toHaveBeenCalledOnce();
  });

  it("leaves Escape to a popover the tooltip sat over", () => {
    const close = vi.fn();
    mount("loupe", { "loupe.close": close });
    const popover = document.body.appendChild(document.createElement("div"));
    popover.setAttribute("role", "dialog");
    escapeThroughTooltip();
    popover.remove();
    expect(close).not.toHaveBeenCalled();
  });
});
