import { expect, test } from "@playwright/test";

async function openZell(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByTestId("root-input").fill("/fake");
  await page.getByTestId("root-submit").click();
  await page.getByTestId("shoot-2026-07-12_zell").click();
  await expect(page.getByTestId("grid")).toBeVisible();
}

test("the export drawer acts on the selection, with quick actions", async ({
  page,
}) => {
  await openZell(page);

  // The top-bar button opens the drawer; nothing selected yet.
  await page.getByTestId("open-export").click();
  await expect(page.getByTestId("export-drawer")).toBeVisible();
  await expect(page.getByTestId("drawer-count")).toHaveText("0");
  await expect(page.getByTestId("run-export")).toBeDisabled();

  // "All" performs a real selection — the grid lights up.
  await page.getByTestId("select-all").click();
  await expect(page.getByTestId("drawer-count")).toHaveText("4");
  await expect(page.getByTestId("selection-count")).toHaveText("4 selected");
  await expect(page.getByTestId("run-export")).toBeEnabled();

  // ⌘-click in the grid fine-tunes it and the drawer follows.
  await page
    .getByTestId("thumb")
    .first()
    .click({ modifiers: ["ControlOrMeta"] });
  await expect(page.getByTestId("drawer-count")).toHaveText("3");

  await page.getByTestId("drawer-clear").click();
  await expect(page.getByTestId("drawer-count")).toHaveText("0");
  await page.getByTestId("drawer-close").click();
  await expect(page.getByTestId("export-drawer")).toHaveCount(0);
});

test("select-filtered follows the histogram filter", async ({ page }) => {
  await openZell(page);

  // ≥2 leaves one photo; the drawer offers exactly that.
  await page.getByTestId("hist-2").click();
  await page.getByTestId("open-export").click();
  await expect(page.getByTestId("select-filtered")).toContainText("1");
  await page.getByTestId("select-filtered").click();
  await expect(page.getByTestId("drawer-count")).toHaveText("1");

  // Select-all must never leave part of the selection invisible: it drops
  // the filter along the way.
  await page.getByTestId("select-all").click();
  await expect(page.getByTestId("drawer-count")).toHaveText("4");
  await expect(page.getByTestId("thumb")).toHaveCount(4);
});

test("export from the loupe returns to the grid with that photo selected", async ({
  page,
}) => {
  await openZell(page);
  await page.getByTestId("thumb").first().click();
  await expect(page.getByTestId("loupe")).toBeVisible();

  await page.getByTestId("open-export").click();
  await expect(page.getByTestId("loupe")).toHaveCount(0);
  await expect(page.getByTestId("grid")).toBeVisible();
  await expect(page.getByTestId("export-drawer")).toBeVisible();
  await expect(page.getByTestId("drawer-count")).toHaveText("1");
  await expect(page.locator("[data-path='DSC00832.ARW']")).toHaveAttribute(
    "data-selected",
    "true",
  );
});

test("a running export reports how far it got, and finishes", async ({
  page,
}) => {
  await openZell(page);
  await page.getByTestId("open-export").click();
  await page.getByTestId("select-all").click();
  await page.getByTestId("run-export").click();

  const running = page.getByTestId("job-running");
  await expect(running).toBeVisible();
  await expect(running).toContainText("of 4");
  await expect(page.getByTestId("job-bar")).toBeVisible();

  const done = page.getByTestId("job-done");
  await expect(done).toBeVisible();
  await expect(done).toContainText("4 files");
  await expect(page.getByTestId("job-running")).toHaveCount(0);
});

test("an export that lost most of its files does not read as a success", async ({
  page,
}) => {
  await page.goto("/?exportfails=3");
  await page.getByTestId("root-input").fill("/fake");
  await page.getByTestId("root-submit").click();
  await page.getByTestId("shoot-2026-07-12_zell").click();
  await page.getByTestId("open-export").click();
  await page.getByTestId("select-all").click();
  await page.getByTestId("run-export").click();

  // Three of four gone is not a green check, and the row has to say which.
  const partial = page.getByTestId("job-partial");
  await expect(partial).toBeVisible();
  await expect(partial).toContainText("3 of 4 failed");
  await expect(page.getByTestId("job-done")).toHaveCount(0);

  await partial.getByText("Which files?").click();
  const failures = page.getByTestId("job-failures");
  await expect(failures.getByRole("listitem")).toHaveCount(3);
  await expect(failures).toContainText("encodeFailed");
});

test("a cancelled zip offers no archive to reveal", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("root-input").fill("/fake");
  await page.getByTestId("root-submit").click();
  await page.getByTestId("shoot-2026-08-01_dolomites").click();
  await page.getByTestId("open-export").click();
  await page.getByTestId("select-all").click();
  await page.getByTestId("dest-zip").click();
  await page.getByTestId("run-export").click();

  await expect(page.getByTestId("job-running")).toBeVisible();
  await page.getByTestId("job-cancel").click();
  const stopped = page.getByTestId("job-cancelled");
  await expect(stopped).toContainText("Cancelled · 0 files");
  // The archive was never written, so revealing it would only raise an error.
  await expect(stopped.getByTitle("Reveal in Finder")).toHaveCount(0);
});

test("a long export can be cancelled and says so", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("root-input").fill("/fake");
  await page.getByTestId("root-submit").click();
  // 200 photos, delivered one per poll: still running when cancel lands.
  await page.getByTestId("shoot-2026-08-01_dolomites").click();
  await page.getByTestId("open-export").click();
  await page.getByTestId("select-all").click();
  await page.getByTestId("run-export").click();

  await expect(page.getByTestId("job-running")).toBeVisible();
  await page.getByTestId("job-cancel").click();
  const stopped = page.getByTestId("job-cancelled");
  await expect(stopped).toContainText("Cancelled");
  await expect(stopped.getByTitle("Reveal in Finder")).toBeVisible();
});

test("format choice shows JPEG quality and names the button", async ({
  page,
}) => {
  await openZell(page);
  await page.getByTestId("open-export").click();
  await page.getByTestId("select-all").click();

  // JPEG (the default) offers the quality toggle and says what it does.
  await expect(page.getByTestId("quality-90")).toBeVisible();
  await expect(page.getByTestId("run-export")).toContainText(
    "Export 4 as JPEG",
  );
  // One selected photo carries an edit in the dataset.
  await expect(page.getByTestId("export-drawer")).toContainText("1 edited");

  // Original copies bytes: no quality, edits ignored.
  await page.getByTestId("format-original").click();
  await expect(page.getByTestId("quality-90")).toHaveCount(0);
  await expect(page.getByTestId("run-export")).toContainText(
    "Export 4 originals",
  );
});

test("the decoder row warns before a RAW 8 export and knows what RAW 9 can reach", async ({
  page,
}) => {
  await openZell(page);
  await page.getByTestId("open-export").click();
  await page.getByTestId("select-all").click();

  // Culling default is RAW 9: no warning in sight.
  await expect(page.getByTestId("export-decoder-9")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("decoder-banner")).toHaveCount(0);

  await page.getByTestId("export-decoder-8").click();
  await expect(page.getByTestId("decoder-banner")).toBeVisible();
  await page.getByTestId("banner-use-raw9").click();
  await expect(page.getByTestId("decoder-banner")).toHaveCount(0);
  await expect(page.getByTestId("export-decoder-9")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByTestId("export-decoder-8").click();
  await page.getByTestId("banner-keep-raw8").click();
  await expect(page.getByTestId("decoder-banner")).toHaveCount(0);
  await expect(page.getByTestId("export-decoder-8")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("a camera without RAW 9 disables the option instead of promising it", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("root-input").fill("/fake");
  await page.getByTestId("root-submit").click();
  await page.getByTestId("shoot-misc").click();
  await expect(page.getByTestId("grid")).toBeVisible();

  await page.getByTestId("open-export").click();
  await page.getByTestId("select-all").click();
  await expect(page.getByTestId("export-decoder-9")).toBeDisabled();
  await expect(page.getByTestId("export-decoder-help")).toContainText(
    "isn't available for these photos on this Mac",
  );
  await expect(page.getByTestId("decoder-banner")).toHaveCount(0);
});
