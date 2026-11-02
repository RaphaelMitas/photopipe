import { expect, type Page, test } from "@playwright/test";
import { openZell } from "./open-shoot";

test.use({ hasTouch: true });

const hitAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([x, y]) =>
      document
        .elementFromPoint(x, y)
        ?.closest("[data-testid]")
        ?.getAttribute("data-testid") ?? null,
    [x, y],
  );

async function box(page: Page, testid: string) {
  const found = await page.getByTestId(testid).first().boundingBox();
  if (!found) throw new Error(`no ${testid}`);
  return found;
}

async function openLoupe(page: Page) {
  await openZell(page);
  await page.locator("[data-path='DSC00832.jpg']").click();
  await expect(page.getByTestId("loupe-name")).toHaveText("DSC00832.jpg");
  expect(
    await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
  ).toBe(true);
}

test("crop handles and straighten zones are finger sized on a touch screen", async ({
  page,
}) => {
  await openLoupe(page);
  await page.getByTestId("enter-crop").click();

  // Pull the crop in so the zones outside its corners lie on the stage.
  const start = await box(page, "crop-handle-tl");
  await page.mouse.move(start.x + 7, start.y + 7);
  await page.mouse.down();
  await page.mouse.move(start.x + 90, start.y + 90, { steps: 5 });
  await page.mouse.up();

  const corner = await box(page, "crop-handle-tl");
  expect(await hitAt(page, corner.x + 25, corner.y + 25)).toBe(
    "crop-handle-tl",
  );
  expect(await hitAt(page, corner.x - 36, corner.y - 36)).toBe(
    "crop-rotate-zone",
  );

  const top = await box(page, "crop-handle-t");
  expect(await hitAt(page, top.x + top.width / 2, top.y + 20)).toBe(
    "crop-handle-t",
  );
});

test("the split divider is finger wide on a touch screen", async ({ page }) => {
  await openLoupe(page);
  await page.keyboard.press("y");
  expect((await box(page, "split-divider")).width).toBeGreaterThanOrEqual(44);
});

test("a tap a fingertip off a curve point grabs it instead of adding one", async ({
  page,
}) => {
  await openLoupe(page);
  const curve = page.getByRole("img", { name: "Tone curve" });
  const bounds = await curve.boundingBox();
  if (!bounds) throw new Error("no curve");

  await page.touchscreen.tap(bounds.x + 13, bounds.y + bounds.height - 13);
  await expect(curve.locator("circle")).toHaveCount(2);
});
