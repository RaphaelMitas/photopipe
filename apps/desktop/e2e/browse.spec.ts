import { expect, test } from "@playwright/test";

async function openZell(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByTestId("root-input").fill("/fake");
  await page.getByTestId("root-submit").click();
  await page.getByTestId("shoot-2026-07-12_zell").click();
  await expect(page.getByTestId("grid")).toBeVisible();
}

test("one surface: grid, shoot in the top bar, export at hand", async ({
  page,
}) => {
  await openZell(page);

  // Every file is its own photo — the ARW and the JPEG of the same shot are
  // two cells, and subfolders just show as part of the name.
  await expect(page.getByTestId("thumb")).toHaveCount(4);
  await expect(page.locator("[data-path='DSC00832.ARW']")).toBeVisible();
  await expect(page.locator("[data-path='DSC00832.jpg']")).toBeVisible();
  await expect(page.locator("[data-path='abends/DSC00938.ARW']")).toBeVisible();

  // The top bar carries the shoot and the way out (export); the sidebar the
  // way back.
  await expect(page.getByTestId("open-export")).toBeVisible();
  await expect(page.getByTestId("current-shoot")).toContainText("zell");
  await expect(page.getByTestId("back-to-shoots")).toBeVisible();
});

test("the histogram shows a count per rating and filters on click", async ({
  page,
}) => {
  await openZell(page);

  // 3 unrated, 1 rated 2 in the zell dataset.
  await expect(page.getByTestId("hist-0")).toContainText("3");
  await expect(page.getByTestId("hist-2")).toContainText("1");

  // Click a bar: ≥2 leaves the one rated photo.
  await page.getByTestId("hist-2").click();
  await expect(page.getByTestId("thumb")).toHaveCount(1);
  await expect(page.locator("[data-path='abends/DSC00938.ARW']")).toBeVisible();

  // Clicking the active bar clears the filter.
  await page.getByTestId("hist-2").click();
  await expect(page.getByTestId("thumb")).toHaveCount(4);

  // The ∅ bar shows only unrated photos.
  await page.getByTestId("hist-0").click();
  await expect(page.getByTestId("thumb")).toHaveCount(3);
  await expect(page.locator("[data-path='abends/DSC00938.ARW']")).toHaveCount(
    0,
  );
});

test("multi-select in the grid drives the action bar", async ({ page }) => {
  await openZell(page);
  // Nothing selected: the workspace stays out of the way.
  await expect(page.getByTestId("selection-bar")).toHaveCount(0);

  const thumbs = page.getByTestId("thumb");
  // ⌘-click enters select mode without opening the photo.
  await thumbs.nth(0).click({ modifiers: ["ControlOrMeta"] });
  await expect(page.getByTestId("selection-count")).toHaveText("1 selected");
  await expect(thumbs.nth(0)).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("loupe")).toHaveCount(0);

  // Now in select mode a plain click toggles instead of opening.
  await thumbs.nth(2).click();
  await expect(page.getByTestId("selection-count")).toHaveText("2 selected");
  await expect(page.getByTestId("loupe")).toHaveCount(0);

  // Shift extends from the last plain click.
  await thumbs.nth(0).click();
  await thumbs.nth(3).click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("selection-count")).toHaveText("4 selected");

  // Esc clears, ⌘A takes everything.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("selection-bar")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.getByTestId("selection-count")).toHaveText("4 selected");
});

test("a click opens the loupe; a long press starts selecting instead", async ({
  page,
}) => {
  await openZell(page);

  // The common case: one click and you're looking at the photo.
  await page.getByTestId("thumb").first().click();
  await expect(page.getByTestId("loupe")).toBeVisible();
  await page.keyboard.press("Escape");

  // Holding enters select mode, and the release must not also open it.
  const thumb = page.getByTestId("thumb").first();
  const box = await thumb.boundingBox();
  if (!box) throw new Error("thumb has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();

  await expect(page.getByTestId("selection-count")).toHaveText("1 selected");
  await expect(page.getByTestId("loupe")).toHaveCount(0);
});

test("delete moves the selection to the Trash and the grid follows", async ({
  page,
}) => {
  await openZell(page);
  await expect(page.getByTestId("thumb")).toHaveCount(4);

  await page
    .locator("[data-path='abends/DSC00943.ARW']")
    .click({ modifiers: ["ControlOrMeta"] });
  await page.getByTestId("action-delete").click();

  await expect(page.getByText(/Moved 1 photo to the Trash/)).toBeVisible();
  await expect(page.getByTestId("thumb")).toHaveCount(3);
  // The selection went with it, so the bar closes.
  await expect(page.getByTestId("selection-bar")).toHaveCount(0);
});

test("grid and list are two views of the same set", async ({ page }) => {
  await openZell(page);

  await expect(page.getByTestId("grid")).toBeVisible();
  await page.getByTestId("view-list").click();
  await expect(page.getByTestId("image-table")).toBeVisible();
  await expect(page.getByTestId("image-row")).toHaveCount(4);
  await page.getByTestId("view-grid").click();
  await expect(page.getByTestId("grid")).toBeVisible();
});

test("the sidebar collapses in browse and loupe alike", async ({ page }) => {
  await openZell(page);
  await expect(page.locator("[data-slot='sidebar-trigger']")).toBeVisible();

  // …and in the loupe, where the sidebar becomes the photo's options.
  await page.getByTestId("thumb").first().click();
  await expect(page.getByTestId("loupe")).toBeVisible();
  await expect(page.locator("[data-slot='sidebar-trigger']")).toBeVisible();
  await expect(page.getByTestId("back-to-grid")).toBeVisible();
});

test("a new project is created from the library and opens empty", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("root-input").fill("/fake");
  await page.getByTestId("root-submit").click();

  await page.getByTestId("new-project").click();
  await page.getByTestId("project-name").fill("riverside");
  await page.getByTestId("project-day").fill("2026-09-09");
  await page.getByTestId("project-notes").fill("client wants 12 finals");
  await page.getByTestId("create-project").click();

  await expect(page.getByText(/Created 2026-09-09_riverside/)).toBeVisible();
  // The fresh project opens empty; folders are the user's own business.
  await expect(page.getByTestId("browser-empty")).toContainText(
    "subfolders are fine",
  );
  await expect(page.getByTestId("empty-import")).toBeVisible();
  await expect(page.getByTestId("import-files")).toBeVisible();
  // Its notes travel with it back on the library card.
  await page.getByTestId("back-to-shoots").click();
  await expect(
    page.getByText("client wants 12 finals", { exact: false }),
  ).toBeVisible();
});

test("library cards show a cover and open project settings", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("root-input").fill("/fake");
  await page.getByTestId("root-submit").click();

  // Every project wears a face: its chosen cover, else its first photo.
  await expect(page.getByTestId("shoot-cover").first()).toBeVisible();

  await page.getByTestId("shoot-settings-2026-07-12_zell").click();
  await expect(page.getByTestId("shoot-name")).toHaveValue("zell");
  await expect(page.getByTestId("shoot-day")).toHaveValue("2026-07-12");
  await expect(page.getByTestId("shoot-notes")).toHaveValue(
    "Golden hour at the river",
  );

  // Picking a cover, and the rename preview appearing only on a real change.
  await expect(page.getByTestId("rename-preview")).toHaveCount(0);
  await page.getByTestId("shoot-name").fill("zell-revisited");
  await expect(page.getByTestId("rename-preview")).toContainText(
    "2026-07-12_zell-revisited",
  );

  const covers = page.getByTestId("cover-choice");
  await covers.nth(1).click();
  await expect(covers.nth(1)).toHaveAttribute("data-chosen", "true");

  await page.getByTestId("save-shoot-settings").click();
  await expect(
    page.getByText(/Renamed to 2026-07-12_zell-revisited/),
  ).toBeVisible();
});
