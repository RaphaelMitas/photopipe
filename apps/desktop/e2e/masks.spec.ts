import { expect, test } from "@playwright/test";
import { openZell } from "./open-shoot";

test("a chip becomes a mask that owns the sliders until Photo takes them back", async ({
  page,
}) => {
  await openZell(page);
  await page.getByTestId("thumb").first().click();
  const exposure = page.getByTestId("exposure").getByRole("slider");
  await page.keyboard.press("ArrowUp");
  await expect(exposure).toHaveAttribute("aria-valuenow", "0.25");
  await expect(page.getByTestId("mask-row-photo")).toHaveCount(0);

  await page.keyboard.press("m");
  await page.getByTestId("mask-chip-subject").hover();
  await expect(page.getByTestId("mask-overlay")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("mask-field")).toHaveCount(0);
  await expect(page.getByTestId("loupe")).toBeVisible();

  await page.getByTestId("mask-add").click();
  await page.getByTestId("mask-chip-background").click();
  const mask = page.getByRole("button", { name: "Background", exact: true });
  await expect(mask).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("mask-field")).toHaveCount(0);
  await expect(exposure).toHaveAttribute("aria-valuenow", "0");
  await expect(page.getByTestId("enter-crop")).toHaveCount(0);

  await page.keyboard.press("ArrowDown");
  await expect(exposure).toHaveAttribute("aria-valuenow", "-0.25");

  await page.getByRole("button", { name: "Photo", exact: true }).click();
  await expect(exposure).toHaveAttribute("aria-valuenow", "0.25");
  await expect(page.getByTestId("enter-crop")).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("loupe-name")).toHaveText("DSC00832.ARW");
  await mask.click();
  await expect(exposure).toHaveAttribute("aria-valuenow", "-0.25");

  await page.getByTestId("mask-invert").click();
  await expect(
    page.getByRole("button", { name: "Subject", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.getByTestId("mask-delete").click();
  await expect(page.getByTestId("mask-row-photo")).toHaveCount(0);
  await expect(exposure).toHaveAttribute("aria-valuenow", "0.25");
});
