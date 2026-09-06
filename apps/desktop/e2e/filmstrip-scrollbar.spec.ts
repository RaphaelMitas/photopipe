import { expect, test } from "@playwright/test";
import { openZell } from "./open-zell";

// Headless Chromium hides scrollbars. macOS draws a classic one inside the
// strip whenever a mouse is connected, and it used to swallow the rating row.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

test("the rating row stays above a classic scrollbar", async ({ page }) => {
  await openZell(page);
  await page.getByTestId("thumb").first().click();
  await page.getByTestId("filmstrip-ratings").click();
  await page.addStyleTag({
    content:
      "[data-testid='filmstrip']{max-width:200px}" +
      "[data-testid='filmstrip']::-webkit-scrollbar{height:15px}",
  });

  const rating = page
    .getByTestId("filmstrip")
    .locator("[data-path='abends/DSC00938.ARW']")
    .getByTestId("filmstrip-rating");
  await expect(rating).toHaveText("2");
  const clipped = await rating.evaluate((el) => {
    const strip = el.closest("[data-testid='filmstrip']");
    if (!strip) throw new Error("rating outside the filmstrip");
    const visibleBottom =
      strip.getBoundingClientRect().top + strip.clientHeight;
    return el.getBoundingClientRect().bottom > visibleBottom;
  });
  expect(clipped).toBe(false);
});
