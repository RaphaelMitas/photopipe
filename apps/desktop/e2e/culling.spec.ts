import { expect, test } from "@playwright/test";

async function openZell(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByTestId("root-input").fill("/fake");
  await page.getByTestId("root-submit").click();
  await page.getByTestId("shoot-2026-07-12_zell").click();
  await expect(page.getByTestId("grid")).toBeVisible();
}

test("clicking a thumb opens the loupe; keyboard rates and navigates", async ({
  page,
}) => {
  await openZell(page);

  await page.getByTestId("thumb").first().click();
  await expect(page.getByTestId("loupe")).toBeVisible();
  await expect(page.getByTestId("loupe-stem")).toHaveText("DSC00832");

  // Rate with the keyboard — stars update optimistically (they live in the
  // options sidebar next to the loupe).
  await page.keyboard.press("3");
  await expect(page.locator("[data-rating='3']")).toBeVisible();

  // Navigate; the pre-rated image shows its stars.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("loupe-stem")).toHaveText("DSC00938");
  await expect(page.locator("[data-rating='2']")).toBeVisible();

  // Escape returns to the grid, which now shows the new rating badge.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("loupe")).toHaveCount(0);
  await expect(
    page.locator("[data-stem='DSC00832']").getByTestId("thumb-rating"),
  ).toHaveText("3");
});

test("rating filter narrows the grid and toggles off", async ({ page }) => {
  await openZell(page);
  await expect(page.getByTestId("thumb")).toHaveCount(4);

  // DSC00938 ships with rating 2 in the mock dataset.
  await page.getByTestId("filter-2").click();
  await expect(page.getByTestId("thumb")).toHaveCount(1);
  await expect(page.locator("[data-stem='DSC00938']")).toBeVisible();

  await page.getByTestId("filter-5").click();
  await expect(page.getByTestId("empty-library")).toHaveCount(0);
  await expect(page.getByTestId("thumb")).toHaveCount(0);

  await page.getByTestId("filter-5").click();
  await expect(page.getByTestId("thumb")).toHaveCount(4);
});

test("rating filter comparators: eq and lte narrow differently", async ({
  page,
}) => {
  await openZell(page);
  await expect(page.getByTestId("thumb")).toHaveCount(4);

  // = 2: only the one image rated exactly 2.
  await page.getByTestId("filter-op-eq").click();
  await page.getByTestId("filter-2").click();
  await expect(page.getByTestId("thumb")).toHaveCount(1);
  await expect(page.locator("[data-stem='DSC00938']")).toBeVisible();

  // ≤ 2: unrated images (0) count too.
  await page.getByTestId("filter-op-lte").click();
  await expect(page.getByTestId("thumb")).toHaveCount(4);

  // ≥ 3: nothing in the default dataset.
  await page.getByTestId("filter-op-gte").click();
  await page.getByTestId("filter-3").click();
  await expect(page.getByTestId("thumb")).toHaveCount(0);
});

test("unrated mode shows only rating-0 images; a star click returns to threshold mode", async ({
  page,
}) => {
  await openZell(page);
  await expect(page.getByTestId("thumb")).toHaveCount(4);

  // ∅: three of the four zell images are unrated.
  await page.getByTestId("filter-op-unrated").click();
  await expect(page.getByTestId("thumb")).toHaveCount(3);
  await expect(page.locator("[data-stem='DSC00938']")).toHaveCount(0);

  // Clicking a star hops back to ≥N.
  await page.getByTestId("filter-2").click();
  await expect(page.getByTestId("thumb")).toHaveCount(1);
  await expect(page.locator("[data-stem='DSC00938']")).toBeVisible();
});

test("the filter is available inside the loupe and info toggle pins the grid overlay", async ({
  page,
}) => {
  await openZell(page);

  // Overlay is hover-only by default, pinned after the toggle.
  const info = page.getByTestId("thumb-info").first();
  await expect(info).toHaveCSS("opacity", "0");
  await page.getByTestId("grid-info-toggle").click();
  await expect(info).toHaveCSS("opacity", "1");

  // The detail sidebar carries the same filter controls. Filtering away the
  // current image must NOT eject the loupe — it stays pinned until you
  // navigate, then ←→ moves within the matches.
  await page.getByTestId("thumb").first().click();
  await expect(page.getByTestId("loupe")).toBeVisible();
  await page.getByTestId("filter-op-eq").click();
  await page.getByTestId("filter-2").click();
  await expect(page.getByTestId("loupe-stem")).toHaveText("DSC00832");
  await expect(page.getByTestId("loupe-position")).toHaveText("1/2");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("loupe-stem")).toHaveText("DSC00938");
  await expect(page.getByTestId("loupe-position")).toHaveText("1/1");
});

test("rating the current image below the filter keeps it in the loupe", async ({
  page,
}) => {
  await openZell(page);
  // ≥2 matches only DSC00938 (rated 2).
  await page.getByTestId("filter-2").click();
  await expect(page.getByTestId("thumb")).toHaveCount(1);
  await page.getByTestId("thumb").first().click();
  await expect(page.getByTestId("loupe-stem")).toHaveText("DSC00938");

  // Clearing its rating un-matches it — the loupe must hold, not eject,
  // even though the filtered list is now empty.
  await page.keyboard.press("0");
  await expect(page.getByTestId("loupe")).toBeVisible();
  await expect(page.getByTestId("loupe-stem")).toHaveText("DSC00938");

  // Leaving deliberately still works.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("loupe")).toHaveCount(0);
  await expect(page.getByTestId("thumb")).toHaveCount(0);
});

test("filmstrip jumps between images and cycles its three modes", async ({
  page,
}) => {
  await openZell(page);
  await page.getByTestId("thumb").first().click();
  await expect(page.getByTestId("loupe")).toBeVisible();

  const filmstrip = page.getByTestId("filmstrip");
  await expect(filmstrip).toBeVisible();
  await expect(filmstrip).toHaveAttribute("data-mode", "thumbs");

  // Click a far frame in the wheel — the loupe jumps there.
  await filmstrip.locator("[data-stem='DSC00943']").click();
  await expect(page.getByTestId("loupe-stem")).toHaveText("DSC00943");

  // Ratings mode: fixed cells with a star row (DSC00938 ships rated 2).
  await page.getByTestId("filmstrip-ratings").click();
  await expect(filmstrip).toHaveAttribute("data-mode", "ratings");
  await expect(
    filmstrip.locator("[data-stem='DSC00938']").getByTestId("filmstrip-rating"),
  ).toHaveText("2");

  // Off hides it entirely; back to thumbs restores.
  await page.getByTestId("filmstrip-off").click();
  await expect(filmstrip).toHaveCount(0);
  await page.getByTestId("filmstrip-thumbs").click();
  await expect(page.getByTestId("filmstrip")).toBeVisible();
});

test("arrow keys scrub exposure and the setting survives navigation", async ({
  page,
}) => {
  await openZell(page);
  await page.getByTestId("thumb").first().click();
  await expect(page.getByTestId("loupe")).toBeVisible();

  await page.keyboard.press("ArrowUp");
  await expect(page.getByText("+0.25")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByText("-0.25")).toBeVisible();

  // Persists while flicking through the shoot.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("loupe-stem")).toHaveText("DSC00938");
  await expect(page.getByText("-0.25")).toBeVisible();

  await page.keyboard.press("r");
  await expect(page.getByText("+0.00")).toBeVisible();
});
