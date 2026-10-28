import { expect, test } from "@playwright/test";
import { openZell } from "./open-shoot";

test("a swapped key flags in the loupe, shows in the tooltip and survives a reload", async ({
  page,
}) => {
  await openZell(page);
  await page.getByTestId("open-settings").click();
  await page.getByTestId("settings-keyboard").click();
  const pick = page.getByTestId("shortcut-flag.pick");
  const reject = page.getByTestId("shortcut-flag.reject");
  await pick.getByRole("button", { name: "Change P for Pick" }).click();
  await page.keyboard.press("x");
  await expect(page.getByTestId("shortcut-conflict")).toContainText("Reject");
  await page.getByTestId("shortcut-conflict-take").click();
  await expect(pick.locator("kbd")).toHaveText("X");
  await expect(reject.locator("kbd")).toHaveText("P");
  await page.keyboard.press("Escape");

  await openZell(page);
  await page.getByTestId("thumb").first().click();
  await page.getByTestId("flag-reject").hover();
  await expect(page.getByRole("tooltip")).toHaveText("RejectP");
  await page.keyboard.press("x");
  await expect(page.locator("[data-flag='1']")).toBeVisible();
});

test("tooltips can be switched off, and ⌘/ lists what works here", async ({
  page,
}) => {
  await openZell(page);
  await page.getByTestId("thumb").first().click();
  await page.keyboard.press("Meta+/");
  const sheet = page.getByTestId("shortcut-sheet");
  await expect(sheet).toContainText("Loupe shortcuts");
  await expect(sheet).toContainText("Next photo");
  await expect(sheet).not.toContainText("Select all");
  await page.getByTestId("shortcut-sheet-edit").click();

  await page.getByTestId("shortcut-tooltips").click();
  await page.keyboard.press("Escape");
  await page.getByTestId("flag-reject").hover();
  await page.waitForTimeout(600);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});
