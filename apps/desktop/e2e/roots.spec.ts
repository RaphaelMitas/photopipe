import { expect, test } from "@playwright/test";

test("a remembered root reopens on launch without a panel", async ({
  page,
}) => {
  await page.goto("/?roots=stored");
  await expect(page.getByTestId("shoot-2026-07-12_zell")).toBeVisible();
  await expect(page.getByTestId("root-input")).toHaveCount(0);
});

test("a broken bookmark stays listed and choosing it again recovers it", async ({
  page,
}) => {
  await page.goto("/?roots=broken");
  const root = page.getByTestId("recent-root");
  await expect(root).toHaveAttribute("data-status", "broken");
  await expect(root).toContainText("choose it again");

  await root.click();
  await expect(page.getByTestId("shoot-2026-07-12_zell")).toBeVisible();

  await page.getByTestId("change-root").click();
  await expect(page.getByTestId("recent-root")).toHaveAttribute(
    "data-status",
    "ok",
  );
});

test("an unplugged drive is greyed out and says so when tried", async ({
  page,
}) => {
  await page.goto("/?roots=unplugged");
  const root = page.getByTestId("recent-root");
  await expect(root).toHaveAttribute("data-status", "unplugged");
  await expect(root).toContainText("connect the drive");
  await expect(page.getByTestId("root-input")).toBeVisible();

  await page.getByTestId("root-input").fill("/fake");
  await page.getByTestId("root-submit").click();
  await expect(page.getByTestId("root-error")).toHaveAttribute(
    "data-kind",
    "unplugged",
  );
  await expect(page.getByTestId("root-error")).toContainText(
    "Connect the drive",
  );
});

test("forgetting a root removes it from the list", async ({ page }) => {
  await page.goto("/?roots=stored");
  await page.getByTestId("change-root").click();
  await page.getByRole("button", { name: "Forget fake" }).click();
  await expect(page.getByTestId("recent-root")).toHaveCount(0);
});
