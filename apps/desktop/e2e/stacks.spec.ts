import { expect, test } from "@playwright/test";
import { openShoot } from "./open-shoot";

test("stacks: rate a whole stack, pick one inside it, undo the pick", async ({
  page,
}) => {
  await openShoot(page, "2026-08-01_dolomites");
  await page.locator("[data-path='DSC01200.ARW']").click();
  await expect(page.getByTestId("loupe-name")).toHaveText("DSC01200.ARW");

  await page.keyboard.press("s");
  await expect(page.getByTestId("stack-chip")).toContainText("3 frames");
  await expect(page.getByTestId("loupe-position")).toHaveText("stack 1/193");

  await page.keyboard.press("4");
  await expect(page.getByTestId("stack-chip")).toContainText("all ★4");

  await page.keyboard.press("Enter");
  await expect(page.getByTestId("stack-chip")).toContainText("Inside stack");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("loupe-name")).toHaveText("DSC01201.ARW");
  await expect(page.getByTestId("stack-pick")).toContainText("clears 2 others");
  await page.keyboard.press("p");
  await expect(page.getByTestId("stack-chip")).toContainText("★4 picked");
  await expect(page.locator("[data-rating='4']")).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("loupe-name")).toHaveText("DSC01203.ARW");
  await expect(page.getByTestId("stack-chip")).toHaveCount(0);

  await page.keyboard.press("Meta+z");
  await expect(page.getByTestId("stack-chip")).toContainText("all ★4");
  // back at stack level, the stage shows the stack's cover, not the frame undo landed on
  await expect(page.getByTestId("loupe-name")).toHaveText("DSC01200.ARW");
});

test("opening a frame that is not its stack's cover starts inside the stack", async ({
  page,
}) => {
  await openShoot(page, "2026-08-01_dolomites");
  await page.locator("[data-path='DSC01200.ARW']").click();
  await page.keyboard.press("s");
  await expect(page.getByTestId("stack-chip")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.locator("[data-path='DSC01207.ARW']").click();
  await expect(page.getByTestId("loupe-name")).toHaveText("DSC01207.ARW");
  await expect(page.getByTestId("stack-chip")).toContainText("Inside stack");
  await expect(page.getByTestId("stack-chip")).toContainText("2 of 5");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("stack-chip")).toContainText("5 frames");
  await expect(page.getByTestId("loupe-name")).toHaveText("DSC01206.ARW");
});
