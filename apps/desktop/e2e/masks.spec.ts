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

test("closing the panel ends the mask session, and M opens both again", async ({
  page,
}) => {
  await openZell(page);
  await page.getByTestId("thumb").first().click();
  await page.keyboard.press("m");
  await page.getByTestId("mask-chip-subject").click();
  const mask = page.getByRole("button", { name: "Subject", exact: true });
  await expect(mask).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("o");
  await expect(page.getByTestId("mask-overlay")).toBeVisible();
  await page.getByTestId("edit-group-masks").click();

  await page.keyboard.press("e");
  await expect(page.getByTestId("mask-overlay")).toHaveCount(0);
  await page.keyboard.press("ArrowUp");

  await page.keyboard.press("m");
  await expect(page.getByTestId("mask-field")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("mask-field")).toHaveCount(0);
  await expect(page.getByTestId("loupe")).toBeVisible();
  await expect(page.getByTestId("mask-row-photo")).toHaveAttribute(
    "data-selected",
    "true",
  );
  const exposure = page.getByTestId("exposure").getByRole("slider");
  await expect(exposure).toHaveAttribute("aria-valuenow", "0.25");
});

test("a new mask flashes its overlay, and the flash ends by itself", async ({
  page,
}) => {
  await openZell(page);
  await page.getByTestId("thumb").first().click();
  await page.keyboard.press("m");
  await page.getByTestId("mask-chip-people").press("Enter");
  const overlay = page.getByTestId("mask-overlay");
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveCount(0);

  await page.getByTestId("mask-invert").press("Enter");
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveCount(0);
});

test("a click on the photo becomes a mask, and Shift-click grows it", async ({
  page,
}) => {
  await openZell(page);
  await page.getByTestId("thumb").first().click();
  const photo = page.getByTestId("loupe-image");
  const preview = page.getByTestId("mask-preview");
  const rows = page.getByRole("button", { name: "Object", exact: true });
  await photo.hover();
  await expect(photo).toBeVisible();
  await expect(preview).toHaveCount(0);

  await page.keyboard.press("m");
  await expect(page.getByTestId("mask-field")).toContainText("click the photo");
  await photo.hover({ position: { x: 200, y: 150 } });
  await expect(preview).toBeVisible();

  await photo.click({ position: { x: 200, y: 150 } });
  await expect(rows).toHaveCount(1);
  await expect(rows).toHaveAttribute("aria-pressed", "true");
  await expect(preview).toHaveCount(0);
  await expect(page.getByTestId("mask-overlay")).toBeVisible();
  await expect(page.getByTestId("mask-field")).toBeVisible();
  await expect(page.getByTestId("history-undo")).toBeEnabled();

  await photo.dblclick({ position: { x: 260, y: 150 } });
  await expect(page.getByTestId("zoom-level")).toHaveCount(0);
  await expect(rows).toHaveCount(2);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("mask-field")).toHaveCount(0);
  await photo.click({ position: { x: 300, y: 150 } });
  await photo.hover({ position: { x: 310, y: 150 } });
  await expect(preview).toHaveCount(0);
  const history = page.getByTestId("history-popover").getByRole("button");
  await page.getByTestId("history-toggle").click();
  await expect(history).toHaveCount(3);
  await page.keyboard.press("Escape");

  await page.keyboard.down("Shift");
  await photo.hover({ position: { x: 320, y: 150 } });
  await expect(preview).toBeVisible();
  await photo.click({ position: { x: 320, y: 150 }, modifiers: ["Shift"] });
  await page.keyboard.up("Shift");
  await expect(preview).toHaveCount(0);
  await expect(rows).toHaveCount(2);

  await page.getByTestId("history-toggle").click();
  await expect(history).toHaveCount(4);
});
