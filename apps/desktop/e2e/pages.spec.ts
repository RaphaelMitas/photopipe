import { expect, test } from "@playwright/test";

async function openZell(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByTestId("root-input").fill("/fake");
  await page.getByTestId("root-submit").click();
  await page.getByTestId("shoot-2026-07-12_zell").click();
  await expect(page.getByTestId("grid")).toBeVisible();
}

test("the top bar switches workspaces and carries nothing else", async ({
  page,
}) => {
  await openZell(page);

  const nav = page.getByTestId("page-nav");
  await expect(nav).toBeVisible();
  await expect(page.getByTestId("page-media")).toHaveAttribute(
    "data-active",
    "true",
  );

  // Every page is reachable at any time — nothing gates anything.
  await page.getByTestId("page-export").click();
  await expect(page.getByTestId("page-export")).toHaveAttribute(
    "data-active",
    "true",
  );
  await page.getByTestId("page-edit").click();
  await expect(page.getByTestId("stage-table")).toBeVisible();

  // ⌘1 returns to Media.
  await page.keyboard.press("ControlOrMeta+1");
  await expect(page.getByTestId("grid")).toBeVisible();

  // The top bar is navigation only — the sidebar shows just the current
  // shoot, with the way back to the library.
  await expect(nav).not.toContainText("zell");
  await expect(page.getByTestId("current-shoot")).toContainText("zell");
  await expect(page.getByTestId("back-to-shoots")).toBeVisible();
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
    .locator("[data-stem='DSC00943']")
    .click({ modifiers: ["ControlOrMeta"] });
  await page.getByTestId("action-delete").click();

  await expect(page.getByText(/Moved 1 photo to the Trash/)).toBeVisible();
  await expect(page.getByTestId("thumb")).toHaveCount(3);
  // The selection went with it, so the bar closes.
  await expect(page.getByTestId("selection-bar")).toHaveCount(0);
});

test("Edit shows only processed files, with their edit status", async ({
  page,
}) => {
  await openZell(page);
  await page.getByTestId("page-edit").click();

  // Only the two images with DNGs appear; bare raws stay on Media.
  const rows = page.getByTestId("stage-row");
  await expect(rows).toHaveCount(2);
  // DSC00832 is already edited (has an export); DSC00938 is not.
  await expect(
    page.locator("[data-testid='stage-row'][data-done='true']"),
  ).toHaveCount(1);
  await expect(
    page.locator("[data-testid='stage-row'][data-done='false']"),
  ).toHaveCount(1);

  await rows.first().click();
  await expect(page.getByTestId("selection-count")).toHaveText("1 selected");
  await expect(page.getByTestId("action-open-in")).toContainText("Open in…");
});

test("Export shows only finished files", async ({ page }) => {
  await openZell(page);
  await page.getByTestId("page-export").click();

  // Only DSC00832 has a JPG in the fake dataset.
  await expect(page.getByTestId("stage-row")).toHaveCount(1);
  await expect(page.getByTestId("stage-row")).toHaveAttribute(
    "data-stem",
    "DSC00832",
  );
});

test("stage pages need a project", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("root-input").fill("/fake");
  await page.getByTestId("root-submit").click();

  await page.getByTestId("page-edit").click();
  await expect(page.getByTestId("no-project")).toContainText("Open a shoot");
});

test("the sidebar collapses from every page, loupe included", async ({
  page,
}) => {
  await openZell(page);
  // Library sidebar.
  await expect(page.locator("[data-slot='sidebar-trigger']")).toBeVisible();

  // …and in the loupe, where the sidebar becomes the photo's options.
  await page.getByTestId("thumb").first().click();
  await expect(page.getByTestId("loupe")).toBeVisible();
  await expect(page.locator("[data-slot='sidebar-trigger']")).toBeVisible();
  await expect(page.getByTestId("back-to-grid")).toBeVisible();
});

test("tab badges count what sits at each stage", async ({ page }) => {
  await openZell(page);
  // 2 images have DNGs to edit; 1 has a finished export.
  await expect(page.getByTestId("badge-edit")).toHaveText("2");
  await expect(page.getByTestId("badge-export")).toHaveText("1");
});

test("the next-step button sends from the page you are on", async ({
  page,
}) => {
  await openZell(page);

  // Media, nothing selected: the button selects everything the filter
  // shows — the filter does the choosing, you prune.
  const next = page.getByTestId("next-step");
  await expect(next).toHaveText(/Select all 4/);
  await next.click();
  await expect(page.getByTestId("selection-count")).toHaveText("4 selected");
  // Prune one — plain clicks toggle while anything is selected.
  await page.getByTestId("thumb").first().click();
  await expect(page.getByTestId("selection-count")).toHaveText("3 selected");

  // With a selection the button is the hand-off: raws go to the denoiser.
  await expect(next).toHaveText(/Send 3 to denoiser/);

  // Edit holds only what came back from the denoiser; the selection that
  // survives the page switch is whatever of it exists here. Clear first.
  await page.getByTestId("page-edit").click();
  await page.keyboard.press("Escape");
  await expect(next).toHaveText(/Select all 2/);
  await next.click();
  await expect(next).toHaveText(/Open 2 in editor/);

  // Export holds the finished files and zips them.
  await page.getByTestId("page-export").click();
  await page.keyboard.press("Escape");
  await expect(next).toHaveText(/Select all 1/);
  await next.click();
  await expect(next).toHaveText(/Export 1/);
});

test("every page offers grid and list views", async ({ page }) => {
  await openZell(page);

  // Media defaults to grid; the toggle switches to the list with ratings.
  await expect(page.getByTestId("grid")).toBeVisible();
  await page.getByTestId("view-list").click();
  await expect(page.getByTestId("stage-table")).toBeVisible();
  await page.getByTestId("view-grid").click();
  await expect(page.getByTestId("grid")).toBeVisible();

  // Edit defaults to list but can show thumbnails as a grid.
  await page.getByTestId("page-edit").click();
  await expect(page.getByTestId("stage-table")).toBeVisible();
  await page.getByTestId("view-grid").click();
  await expect(page.getByTestId("grid")).toBeVisible();
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
  // The fresh project opens, empty, pointing at its original/ folder.
  await expect(page.getByTestId("stage-empty")).toContainText("original/");
  // Its notes travel with it back on the library card.
  await page.getByTestId("back-to-shoots").click();
  await expect(
    page.getByText("client wants 12 finals", { exact: false }),
  ).toBeVisible();
});

test("import sits next to reveal in the sidebar, on every page", async ({
  page,
}) => {
  await openZell(page);
  for (const name of ["media", "edit", "export"]) {
    await page.getByTestId(`page-${name}`).click();
    await expect(page.getByTestId("import-files")).toBeVisible();
    await expect(page.getByTestId("reveal-shoot")).toBeVisible();
  }

  // A fresh, empty project offers import from the sidebar and from the
  // empty state itself.
  await page.getByTestId("page-media").click();
  await page.getByTestId("back-to-shoots").click();
  await page.getByTestId("new-project").click();
  await page.getByTestId("project-name").fill("empty");
  await page.getByTestId("create-project").click();
  await expect(page.getByTestId("stage-empty")).toContainText("Import them");
  await expect(page.getByTestId("empty-import")).toBeVisible();
  await expect(page.getByTestId("import-files")).toBeVisible();
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

test("settings switch the flow between denoise and edit-only", async ({
  page,
}) => {
  await openZell(page);
  // Denoise is part of the flow by default, so Media sends to the denoiser
  // and Edit shows only what came back.
  await page.getByTestId("next-step").click();
  await expect(page.getByTestId("next-step")).toHaveText(/Send 4 to denoiser/);
  await page.getByTestId("page-edit").click();
  await expect(page.getByTestId("stage-row")).toHaveCount(2);

  // Opting out of processing rewires both.
  await page.getByTestId("app-settings").click();
  await page.getByTestId("processing-mode").click();
  await page.getByRole("option", { name: "No processing step" }).click();
  await page.getByTestId("settings-done").click();

  // Edit now works from the originals rather than sitting permanently empty.
  await expect(page.getByTestId("stage-row")).toHaveCount(4);
  await page.getByTestId("page-media").click();
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.getByTestId("next-step")).toHaveText(/Open 4 in editor/);
});
