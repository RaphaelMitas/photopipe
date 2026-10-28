import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { bindingsOf, resetAllShortcuts } from "@/lib/shortcuts";
import { KeyboardSettings } from "./KeyboardSettings";

afterEach(() => {
  cleanup();
  resetAllShortcuts();
});

it("stops recording when you click elsewhere, so typing a search binds nothing", () => {
  render(<KeyboardSettings />);
  fireEvent.click(screen.getByRole("button", { name: "Change P for Pick" }));
  const search = screen.getByTestId("shortcut-search");
  fireEvent.pointerDown(search);
  fireEvent.keyDown(search, { key: "f", code: "KeyF" });
  expect(bindingsOf("flag.pick")).toEqual(["p"]);
});
