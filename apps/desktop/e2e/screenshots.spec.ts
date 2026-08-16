import { expect, test } from "@playwright/test";

// README artwork, captured from the real UI against the e2e mock so the
// pictures can never drift from the app. Tagged @screenshots: `pnpm e2e`
// greps these out, `pnpm screenshots` runs only these.
//
// The photos are drawn landscapes (see placeholderFor in lib/placeholder.ts).
// Nothing here is a real shoot, and nothing depends on the machine it runs
// on, so the output is identical for anyone who regenerates it.

const SHOTS = "../../docs/screenshots";

test.use({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
});

async function openLibrary(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByTestId("root-input").fill("/Users/you/Pictures/Camera");
  await page.getByTestId("root-submit").click();
  await expect(page.getByTestId("shoot-2026-07-12_zell")).toBeVisible();
}

test("@screenshots library", async ({ page }) => {
  await openLibrary(page);
  // Covers load lazily; wait for one to have real dimensions.
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
