import type { Locator, Page } from "@playwright/test";

export const hitAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([x, y]) =>
      document
        .elementFromPoint(x, y)
        ?.closest("[data-testid]")
        ?.getAttribute("data-testid") ?? null,
    [x, y],
  );

export async function hitAtCenter(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`no box for ${locator}`);
  return hitAt(locator.page(), box.x + box.width / 2, box.y + box.height / 2);
}
