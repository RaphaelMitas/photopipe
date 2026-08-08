import { expect, test } from "@playwright/test";

test("app boots and reports the core version over (mocked) IPC", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("core-status")).toHaveText(
    "photopipe-core v0.0.0-e2e · protocol 1",
  );
});
