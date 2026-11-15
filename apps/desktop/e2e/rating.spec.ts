import { expect, test } from "@playwright/test";

test("the rating pass names itself, then hands over the new sort", async ({
  page,
}) => {
  await page.goto("/?scoring");
  await page.getByTestId("root-input").fill("/fake");
  await page.getByTestId("root-submit").click();
  await page.getByTestId("shoot-2026-07-12_zell").click();
  await expect(page.getByTestId("grid")).toBeVisible();

  await expect(page.getByTestId("rating-now")).toContainText(
    "Instinct is rating",
  );
  await expect(page.getByTestId("rating-progress")).toBeVisible();
  await expect(page.getByTestId("sort")).toContainText("Name");

  const offer = page.getByTestId("rated-offer");
  await expect(offer).toBeVisible();
  await expect(page.getByTestId("rating-now")).toBeHidden();
  await expect(page.getByTestId("rating-progress")).toBeHidden();

  await offer.click();
  await expect(offer).toBeHidden();
  await expect(page.getByTestId("sort")).toContainText("Instinct");

  await expect(page.getByTestId("thumb").first()).toHaveAttribute(
    "data-path",
    "abends/DSC00938.ARW",
  );
});
