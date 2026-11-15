import { expect, test } from "@playwright/test";
import { openZell } from "./open-shoot";

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

test("the rating row stays above a classic scrollbar", async ({ page }) => {
  await openZell(page);
  await page.getByTestId("thumb").first().click();
  await page.getByTestId("filmstrip-ratings").click();
  const strip = page.getByTestId("filmstrip");
  await strip.evaluate((el) => {
    el.style.maxWidth = "200px";
  });
  await page.addStyleTag({
    content: "[data-testid='filmstrip']::-webkit-scrollbar{height:15px}",
  });

  const rating = strip
    .locator("[data-path='abends/DSC00938.ARW']")
    .getByTestId("filmstrip-rating");
  await expect(rating).toHaveText("2");

  const gutter = await strip.evaluate((el: HTMLElement) => {
    const style = getComputedStyle(el);
    return (
      el.offsetHeight -
      el.clientHeight -
      parseFloat(style.borderTopWidth) -
      parseFloat(style.borderBottomWidth)
    );
  });
  expect(gutter).toBeGreaterThanOrEqual(10);

  const clipped = await rating.evaluate((el) => {
    const parent = el.closest("[data-testid='filmstrip']");
    if (!parent) throw new Error("rating outside the filmstrip");
    const visibleBottom =
      parent.getBoundingClientRect().top +
      parent.clientTop +
      parent.clientHeight;
    return el.getBoundingClientRect().bottom > visibleBottom;
  });
  expect(clipped).toBe(false);
});
