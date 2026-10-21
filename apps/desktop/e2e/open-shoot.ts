import { expect, type Page } from "@playwright/test";

export async function openShoot(
  page: Page,
  shoot: string,
  { url = "/", root = "/fake" } = {},
) {
  await page.goto(url);
  await page.getByTestId("root-input").fill(root);
  await page.getByTestId("root-submit").click();
  await page.getByTestId(`shoot-${shoot}`).click();
  await expect(page.getByTestId("grid")).toBeVisible();
}

export const openZell = (page: Page) => openShoot(page, "2026-07-12_zell");
