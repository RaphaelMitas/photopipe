import { expect, type Page, test } from "@playwright/test";

const SHOTS = "../../docs/screenshots";

test.use({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
});

async function openLibrary(page: Page) {
  await page.goto("/");
  await page.getByTestId("root-input").fill("/Users/you/Pictures/Camera");
  await page.getByTestId("root-submit").click();
  await expect(page.getByTestId("shoot-2026-07-12_zell")).toBeVisible();
}

test("@screenshots library", async ({ page }) => {
  await openLibrary(page);
  await expect(page.getByTestId("shoot-cover").first()).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/library.png` });
});

test("@screenshots browse grid with a selection", async ({ page }) => {
  await openLibrary(page);
  await page.getByTestId("shoot-2026-08-01_dolomites").click();
  await expect(page.getByTestId("grid")).toBeVisible();

  const thumbs = page.getByTestId("thumb");
  await thumbs.nth(2).click({ modifiers: ["ControlOrMeta"] });
  await thumbs.nth(3).click();
  await thumbs.nth(7).click();
  await expect(page.getByTestId("selection-count")).toHaveText("3 selected");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/browse.png` });
});

test("@screenshots loupe with the filmstrip", async ({ page }) => {
  await openLibrary(page);
  await page.getByTestId("shoot-2026-07-12_zell").click();
  await page.getByTestId("thumb").first().click();
  await expect(page.getByTestId("loupe")).toBeVisible();
  await page.keyboard.press("4");
  await expect(page.locator("[data-rating='4']")).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/loupe.png` });
});

test("@screenshots export drawer", async ({ page }) => {
  await openLibrary(page);
  await page.getByTestId("shoot-2026-08-01_dolomites").click();
  await expect(page.getByTestId("grid")).toBeVisible();
  await page.getByTestId("open-export").click();
  await page.getByTestId("select-all").click();
  await expect(page.getByTestId("drawer-count")).toHaveText("200");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/export.png` });
});
