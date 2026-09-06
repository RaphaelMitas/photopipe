import { expect, type Page } from "@playwright/test";

export async function openZell(page: Page) {
  await page.goto("/");
  await page.getByTestId("root-input").fill("/fake");
  await page.getByTestId("root-submit").click();
  await page.getByTestId("shoot-2026-07-12_zell").click();
  await expect(page.getByTestId("grid")).toBeVisible();
}
