import { expect, type Locator, type Page, test } from "@playwright/test";
import { openZell } from "./open-shoot";

test.use({ hasTouch: true });

type Point = { clientX: number; clientY: number };

async function drag(target: Locator, from: Point, to: Point) {
  const touch = { pointerType: "touch", pointerId: 7, bubbles: true };
  await target.dispatchEvent("pointerdown", { ...touch, ...from });
  await target.dispatchEvent("pointermove", { ...touch, ...to });
  await target.dispatchEvent("pointerup", { ...touch, ...to });
}

const hitAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([x, y]) =>
      document
        .elementFromPoint(x, y)
        ?.closest("[data-testid]")
        ?.getAttribute("data-testid") ?? null,
    [x, y],
  );

async function box(locator: Locator) {
  const found = await locator.first().boundingBox();
  if (!found) throw new Error(`no box for ${locator}`);
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

  const fullFrameTop = await box(page.getByTestId("crop-handle-t"));
  expect(
    await hitAt(
      page,
      fullFrameTop.x + fullFrameTop.width / 2,
      fullFrameTop.y - 15,
    ),
  ).toBe("crop-handle-t");

  // Pull the crop in so the zones outside its corners lie on the stage.
  const start = await box(page.getByTestId("crop-handle-tl"));
  await page.mouse.move(start.x + 7, start.y + 7);
  await page.mouse.down();
  await page.mouse.move(start.x + 90, start.y + 90, { steps: 5 });
  await page.mouse.up();

  // Each probe sits past the mouse grab area but inside the finger one.
  const corner = await box(page.getByTestId("crop-handle-tl"));
  expect(await hitAt(page, corner.x + 26, corner.y + 26)).toBe(
    "crop-handle-tl",
  );
  expect(await hitAt(page, corner.x - 36, corner.y - 36)).toBe(
    "crop-rotate-zone",
  );

  const top = await box(page.getByTestId("crop-handle-t"));
  expect(await hitAt(page, top.x + top.width / 2, top.y + 20)).toBe(
    "crop-handle-t",
  );
});

test("the split divider is finger wide on a touch screen", async ({ page }) => {
  await openLoupe(page);
  await page.keyboard.press("y");
  expect(
    (await box(page.getByTestId("split-divider"))).width,
  ).toBeGreaterThanOrEqual(44);
});

test("a finger a tip off a curve point grabs it, and its wobble does not yank it", async ({
  page,
}) => {
  await openLoupe(page);
  const curve = page.getByRole("img", { name: "Tone curve" });
  const bounds = await box(curve);
  const clientX = bounds.x + 13;
  const clientY = bounds.y + bounds.height - 13;

  await drag(curve, { clientX, clientY }, { clientX: clientX + 1, clientY });
  await expect(curve.locator("circle")).toHaveCount(2);
  expect(
    Number(await curve.locator("circle").first().getAttribute("cx")),
  ).toBeLessThan(2);
});

test("a finger on a curve point grabs that point, not a close neighbour", async ({
  page,
}) => {
  await openLoupe(page);
  const curve = page.getByRole("img", { name: "Tone curve" });
  const bounds = await box(curve);
  const at = (x: number, y: number) => ({
    clientX: bounds.x + x * bounds.width,
    clientY: bounds.y + (1 - y) * bounds.height,
  });

  await page.mouse.click(at(0.4, 0.4).clientX, at(0.4, 0.4).clientY);
  await page.mouse.click(at(0.46, 0.46).clientX, at(0.46, 0.46).clientY);
  await expect(curve.locator("circle")).toHaveCount(4);

  await drag(curve, at(0.46, 0.46), at(0.46, 0.8));

  const heights = await curve
    .locator("circle")
    .evaluateAll((circles) => circles.map((c) => c.getAttribute("cy")));
  expect(Number(heights[1])).toBeCloseTo((1 - 0.4) * 140, 0);
  expect(Number(heights[2])).toBeCloseTo((1 - 0.8) * 140, 0);
});
