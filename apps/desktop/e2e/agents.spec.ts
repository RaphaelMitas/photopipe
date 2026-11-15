import { expect, type Page, test } from "@playwright/test";
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

const ask = (page: Page, tool: string, args: object) =>
  page.evaluate(([tool, args]) => Reflect.get(window, "askAgent")(tool, args), [
    tool,
    args,
  ] as const);

test("an agent's rating lands like a keypress and undoes like one", async ({
  page,
}) => {
  await openZell(page);
  const photo = "2026-07-12_zell/DSC00832.ARW";
  const thumb = page.locator("[data-path='DSC00832.ARW']");

  expect(await ask(page, "rate", { photos: [photo], rating: 4 })).toMatchObject(
    { ok: true, value: { changed: 1 } },
  );
  await expect(thumb.getByTestId("thumb-rating")).toContainText("4");

  expect(await ask(page, "undo", { steps: 1, redo: false })).toMatchObject({
    ok: true,
    value: { undid: ["Rating ★★★★"] },
  });
  await expect(thumb.getByTestId("thumb-rating")).toBeHidden();

  expect(
    await ask(page, "rate", {
      photos: ["2026-08-01_dolomites/DSC01200.ARW"],
      rating: 2,
    }),
  ).toMatchObject({ ok: false, value: expect.stringContaining("show") });
});

test("an agent opens a photo in the loupe and reads the view back", async ({
  page,
}) => {
  await openZell(page);
  const reply = await ask(page, "show", {
    shoot: null,
    photo: "2026-07-12_zell/abends/DSC00938.ARW",
    select: null,
  });
  expect(reply).toMatchObject({
    ok: true,
    value: {
      shoot: "2026-07-12_zell",
      mode: "loupe",
      photo: "2026-07-12_zell/abends/DSC00938.ARW",
    },
  });
  await expect(page.getByTestId("loupe-name")).toContainText("DSC00938");

  expect(await ask(page, "ui_action", { action: "exposure.up" })).toMatchObject(
    { ok: true, value: { history: [{ undone: false }] } },
  );
  expect(await ask(page, "ui_action", { action: "photo.next" })).toMatchObject({
    ok: true,
    value: { mode: "loupe" },
  });
  expect(await ask(page, "ui_action", { action: "crop.apply" })).toMatchObject({
    ok: false,
  });
});
