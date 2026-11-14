import { expect, test } from "@playwright/test";
import { openZell } from "./open-shoot";

test("agents start with nothing to see, and the choice sticks across a reopen", async ({
  page,
}) => {
  await openZell(page);
  await page.getByTestId("open-settings").click();
  await page.getByTestId("settings-agents").click();
  await expect(page.getByTestId("agent-see-off")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("--mcp").first()).toBeVisible();

  await page.getByTestId("agent-see-pictures").click();
  await expect(page.getByText("rendered on this Mac")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByTestId("open-settings").click();
  await page.getByTestId("settings-agents").click();
  await expect(page.getByTestId("agent-see-pictures")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
