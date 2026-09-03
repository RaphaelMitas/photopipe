import { expect, test } from "@playwright/test";

async function openZell(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByTestId("root-input").fill("/fake");
  await page.getByTestId("root-submit").click();
  await page.getByTestId("shoot-2026-07-12_zell").click();
  await expect(page.getByTestId("grid")).toBeVisible();
}

async function sortByRating(page: import("@playwright/test").Page) {
  await page.getByTestId("sort").click();
  await page.getByTestId("sort-rating").click();
  await expect(page.getByTestId("sort")).toContainText("Rating");
}

test("clicking a thumb opens the loupe; keyboard rates and navigates", async ({
  page,
}) => {
  await openZell(page);

  await page.getByTestId("thumb").first().click();
  await expect(page.getByTestId("loupe")).toBeVisible();
  await expect(page.getByTestId("loupe-name")).toHaveText("DSC00832.ARW");

  // Rate with the keyboard — stars update optimistically (they live in the
  // options sidebar next to the loupe).
  await page.keyboard.press("3");
  await expect(page.locator("[data-rating='3']")).toBeVisible();

  // The JPEG of the same shot is its own photo, unrated.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("loupe-name")).toHaveText("DSC00832.jpg");
  await expect(page.locator("[data-rating='0']")).toBeVisible();

  // The pre-rated image shows its stars.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("loupe-name")).toHaveText(
    "abends/DSC00938.ARW",
  );
  await expect(page.locator("[data-rating='2']")).toBeVisible();

  // Escape returns to the grid, which now shows the new rating badge.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("loupe")).toHaveCount(0);
  await expect(
    page.locator("[data-path='DSC00832.ARW']").getByTestId("thumb-rating"),
  ).toHaveText("3");
});

test("histogram comparators: eq and lte narrow differently", async ({
  page,
}) => {
  await openZell(page);
  await expect(page.getByTestId("thumb")).toHaveCount(4);

  // = 2: only the one image rated exactly 2.
  await page.getByTestId("filter-op-eq").click();
  await page.getByTestId("hist-2").click();
  await expect(page.getByTestId("thumb")).toHaveCount(1);
  await expect(page.locator("[data-path='abends/DSC00938.ARW']")).toBeVisible();

  // ≤ 2: unrated images (0) count too.
  await page.getByTestId("filter-op-lte").click();
  await expect(page.getByTestId("thumb")).toHaveCount(4);

  // ≥ 3: nothing in the default dataset.
  await page.getByTestId("filter-op-gte").click();
  await page.getByTestId("hist-3").click();
  await expect(page.getByTestId("thumb")).toHaveCount(0);
});

test("unrated mode shows only rating-0 images; a bar click returns to threshold mode", async ({
  page,
}) => {
  await openZell(page);
  await expect(page.getByTestId("thumb")).toHaveCount(4);

  // ∅: three of the four zell images are unrated.
  await page.getByTestId("filter-op-unrated").click();
  await expect(page.getByTestId("thumb")).toHaveCount(3);
  await expect(page.locator("[data-path='abends/DSC00938.ARW']")).toHaveCount(
    0,
  );

  // Clicking a star bar hops back to ≥N.
  await page.getByTestId("hist-2").click();
  await expect(page.getByTestId("thumb")).toHaveCount(1);
  await expect(page.locator("[data-path='abends/DSC00938.ARW']")).toBeVisible();
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
  await page.getByTestId("hist-2").click();
  await expect(page.getByTestId("loupe-name")).toHaveText("DSC00832.ARW");
  await expect(page.getByTestId("loupe-position")).toHaveText("1/2");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("loupe-name")).toHaveText(
    "abends/DSC00938.ARW",
  );
  await expect(page.getByTestId("loupe-position")).toHaveText("1/1");
});

test("rating the open photo under Rating sort still advances to the next one", async ({
  page,
}) => {
  await openZell(page);
  await sortByRating(page);

  // Rating order leads with the one pre-rated photo, then the unrated three
  // in name order.
  await page.getByTestId("thumb").nth(1).click();
  await expect(page.getByTestId("loupe-name")).toHaveText("DSC00832.ARW");

  // Five stars moves this photo to the front of the sort under you.
  await page.keyboard.press("5");
  await expect(page.locator("[data-rating='5']")).toBeVisible();
  await expect(page.getByTestId("loupe-position")).toHaveText("1/4");

  // Advancing must still reach the photo that was next when you started
  // walking, not one you already passed.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("loupe-name")).toHaveText("DSC00832.jpg");
});

test("a photo rated out of the filter under Rating sort holds its place", async ({
  page,
}) => {
  await openZell(page);

  // Spread some stars first: 5, 3, 2 (already), 4 in name order.
  await page.getByTestId("thumb").first().click();
  await page.keyboard.press("5");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("3");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("loupe-name")).toHaveText(
    "abends/DSC00943.ARW",
  );
  await page.keyboard.press("4");
  await page.keyboard.press("Escape");

  await sortByRating(page);
  await page.getByTestId("hist-3").click();
  await expect(page.getByTestId("thumb")).toHaveCount(3);

  await page.getByTestId("thumb").nth(1).click();
  await expect(page.getByTestId("loupe-name")).toHaveText(
    "abends/DSC00943.ARW",
  );
  await expect(page.getByTestId("loupe-position")).toHaveText("2/3");

  // Clearing its stars drops it out of the filter. The loupe pins it where it
  // stood, so ←→ keep walking the matches around it.
  await page.keyboard.press("0");
  await expect(page.locator("[data-rating='0']")).toBeVisible();
  await expect(page.getByTestId("loupe-position")).toHaveText("2/3");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("loupe-name")).toHaveText("DSC00832.jpg");
});

test("rating the current image below the filter keeps it in the loupe", async ({
  page,
}) => {
  await openZell(page);
  // ≥2 matches only DSC00938 (rated 2).
  await page.getByTestId("hist-2").click();
  await expect(page.getByTestId("thumb")).toHaveCount(1);
  await page.getByTestId("thumb").first().click();
  await expect(page.getByTestId("loupe-name")).toHaveText(
    "abends/DSC00938.ARW",
  );

  // Clearing its rating un-matches it — the loupe must hold, not eject,
  // even though the filtered list is now empty.
  await page.keyboard.press("0");
  await expect(page.getByTestId("loupe")).toBeVisible();
  await expect(page.getByTestId("loupe-name")).toHaveText(
    "abends/DSC00938.ARW",
  );

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
  await filmstrip.locator("[data-path='abends/DSC00943.ARW']").click();
  await expect(page.getByTestId("loupe-name")).toHaveText(
    "abends/DSC00943.ARW",
  );

  // Ratings mode: fixed cells with a star row (DSC00938 ships rated 2).
  await page.getByTestId("filmstrip-ratings").click();
  await expect(filmstrip).toHaveAttribute("data-mode", "ratings");
  await expect(
    filmstrip
      .locator("[data-path='abends/DSC00938.ARW']")
      .getByTestId("filmstrip-rating"),
  ).toHaveText("2");

  // Off hides it entirely; back to thumbs restores.
  await page.getByTestId("filmstrip-off").click();
  await expect(filmstrip).toHaveCount(0);
  await page.getByTestId("filmstrip-thumbs").click();
  await expect(page.getByTestId("filmstrip")).toBeVisible();
});

test("exposure is per photo and survives leaving and returning", async ({
  page,
}) => {
  await openZell(page);
  await page.getByTestId("thumb").first().click();
  await expect(page.getByTestId("loupe")).toBeVisible();

  await page.keyboard.press("ArrowUp");
  await expect(page.getByText("+0.25")).toBeVisible();

  // The edit belongs to this photo — the neighbor shows its own value
  // (DSC00832.jpg ships with +0.50 in the dataset).
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("loupe-name")).toHaveText("DSC00832.jpg");
  await expect(page.getByText("+0.50")).toBeVisible();

  // Back on the first photo the persisted value is still there.
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("loupe-name")).toHaveText("DSC00832.ARW");
  await expect(page.getByText("+0.25")).toBeVisible();

  // The grid marks edited photos.
  await page.keyboard.press("Escape");
  await expect(
    page.locator("[data-path='DSC00832.jpg']").getByTestId("thumb-edited"),
  ).toHaveText("+0.5 EV");
});

test("a look copied off one photo lands on a selection, and undo takes it back", async ({
  page,
}) => {
  await openZell(page);

  await page.getByTestId("thumb").first().click();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("loupe-name")).toHaveText("DSC00832.jpg");
  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("Escape");

  await page
    .locator("[data-path='DSC00832.ARW']")
    .click({ modifiers: ["ControlOrMeta"] });
  await page
    .locator("[data-path='abends/DSC00938.ARW']")
    .click({ modifiers: ["ControlOrMeta"] });
  await expect(page.getByTestId("selection-count")).toHaveText("2 selected");

  await page.keyboard.press("ControlOrMeta+v");
  for (const path of ["DSC00832.ARW", "abends/DSC00938.ARW"]) {
    await expect(
      page.locator(`[data-path='${path}']`).getByTestId("thumb-edited"),
    ).toHaveText("+0.5 EV");
  }

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(
    page.locator("[data-path='DSC00832.ARW']").getByTestId("thumb-edited"),
  ).toHaveCount(0);
});

test("zooming renders the visible slice and drops it again on fit", async ({
  page,
}) => {
  await openZell(page);
  await page.getByTestId("thumb").first().click();
  await expect(page.getByTestId("loupe")).toBeVisible();
  await expect(page.getByTestId("loupe-region")).toHaveCount(0);

  const photo = await page.getByTestId("loupe-image").boundingBox();
  if (!photo) throw new Error("no photo on the stage");
  const centre = {
    x: photo.x + photo.width / 2,
    y: photo.y + photo.height / 2,
  };
  await page.mouse.dblclick(centre.x, centre.y);
  await expect(page.getByTestId("zoom-level")).toContainText("100%");

  // The point of the slice is that it is not a scaled-up copy of the fitted
  // render: it sits outside the zoom transform, laid out at its own on-screen
  // size, and it covers what you are looking at.
  const region = page.getByTestId("loupe-region");
  await expect(region).toHaveCount(1);
  const geometry = await region.evaluate((img) => {
    const parent = img.parentElement as HTMLElement;
    const box = img.getBoundingClientRect();
    const stage = parent.getBoundingClientRect();
    return {
      parentTransform: getComputedStyle(parent).transform,
      coversCentre:
        box.left <= stage.left + stage.width / 2 &&
        box.right >= stage.left + stage.width / 2 &&
        box.top <= stage.top + stage.height / 2 &&
        box.bottom >= stage.top + stage.height / 2,
    };
  });
  expect(geometry.parentTransform).toBe("none");
  expect(geometry.coversCentre).toBe(true);

  await page.mouse.dblclick(centre.x, centre.y);
  await expect(page.getByTestId("zoom-level")).toHaveCount(0);
  await expect(page.getByTestId("loupe-region")).toHaveCount(0);
});

test("the decoder tooltip opens and closes on a real click", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("root-input").fill("/fake");
  await page.getByTestId("root-submit").click();
  await page.getByTestId("shoot-2026-07-12_zell").click();
  await page.getByTestId("thumb").first().click();
  await expect(page.getByTestId("loupe")).toBeVisible();

  // jsdom lets a pointerdown-only handler look like it works; a real click
  // fires the whole sequence, which is where Radix's own close lives.
  const info = page.getByTestId("decoder-info");
  const tip = page.getByText("Applies to every photo");
  await expect(tip).toHaveCount(0);
  await info.click();
  await expect(tip).toBeVisible();
  await info.click();
  await expect(tip).toHaveCount(0);
});
