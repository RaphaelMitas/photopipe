import { expect, test } from "@playwright/test";

test("first launch asks for a root, then shows the dashboard", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("root-input").fill("/fake");
  await page.getByTestId("root-submit").click();

  const zell = page.getByTestId("shoot-2026-07-12_zell");
  await expect(zell).toBeVisible();
  await expect(zell).toContainText("zell");
  await expect(zell).toContainText("2 raw");
  await expect(zell).toContainText("1 denoised");
  await expect(zell).toContainText("1 exported");
  await expect(page.getByTestId("shoot-misc")).toContainText("1 photos");
});

test("opening a shoot shows its grid; back returns to the library", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("root-input").fill("/fake");
  await page.getByTestId("root-submit").click();

  await page.getByTestId("shoot-2026-07-12_zell").click();
  await expect(page.getByTestId("grid")).toBeVisible();
  await expect(page.getByTestId("thumb")).toHaveCount(4);
  await expect(page.getByText("DSC00832")).toBeVisible();

  await page.getByTestId("back").click();
  await expect(page.getByTestId("shoot-2026-07-12_zell")).toBeVisible();
});

test("a bad root surfaces the core error instead of hanging", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("root-input").fill("/nonexistent");
  await page.getByTestId("root-submit").click();
  await expect(page.getByTestId("root-error")).toContainText("root_not_found");
});
