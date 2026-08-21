import { expect, test } from "@playwright/test";

test("review: settings cards and decoder strip", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("photopipe.rawDecoderQuickSwitch", "on");
  });
  await page.goto("/");
  await page.getByTestId("root-input").fill("/fake");
  await page.getByTestId("root-submit").click();

  await page.getByTestId("open-settings").click();
  await expect(page.getByTestId("decoder-9")).toBeVisible();
  await page.screenshot({ path: "/tmp/review-settings.png" });
  await page.keyboard.press("Escape");

  await page.getByTestId("shoot-2026-07-12_zell").click();
  await page.getByTestId("thumb").first().dblclick();
  await page.getByTestId("toggle-edit").click();
  await page.waitForTimeout(300);
  if (!(await page.getByTestId("edit-sidebar").count()))
    await page.getByTestId("toggle-edit").click();
  await page.screenshot({ path: "/tmp/review-afterclick.png", fullPage: true });
  console.log("TESTIDS", await page.evaluate(() => Array.from(document.querySelectorAll("[data-testid]")).map(e => e.getAttribute("data-testid")).join(",")));
  await expect(page.getByTestId("edit-sidebar")).toBeVisible();
  console.log("LS", await page.evaluate(() => JSON.stringify(localStorage)));
  console.log("SIDEBAR", await page.getByTestId("edit-sidebar").innerText());
  const strip = page.getByTestId("decoder-strip");
  await expect(strip).toBeVisible();
  await page.screenshot({ path: "/tmp/review-editor.png" });
  await strip.screenshot({ path: "/tmp/review-strip.png" });

  const box = await strip.boundingBox();
  const pill = await strip.locator("span").first().boundingBox();
  const seg = await page.getByTestId("decoder-quick-9").boundingBox();
  console.log("STRIP", JSON.stringify({ box, pill, seg }));

  const overflow = await strip.evaluate(
    (el) => el.scrollWidth - el.clientWidth,
  );
  console.log("OVERFLOW", overflow);

  await page.getByTestId("decoder-info").hover();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/review-tooltip.png" });

  await page.getByTestId("decoder-info").click();
  await page.waitForTimeout(400);
  const tipAfterClick = await page
    .locator("[data-slot=tooltip-content]")
    .count();
  console.log("TOOLTIP AFTER CLICK", tipAfterClick);
});
