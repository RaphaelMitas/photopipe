import { mkdirSync, readFileSync } from "node:fs";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { openShoot } from "./open-shoot";
import {
  type Asset,
  type Capture,
  CREATIVE_ASSETS,
  type Device,
  framePage,
  frames,
  SIZES,
  type Size,
} from "./store/frames";

// The App Store screenshots: the real UI against the e2e mock in `?store`
// mode, with the maker's own photos from e2e/store, framed by store/frames.ts.
// Tagged @store: `pnpm store-screenshots` runs only these and writes to
// store-screenshots/.

const IPAD = {
  name: "ipad",
  url: "/?store&ipad",
  root: "/private/var/mobile/Library/LiveFiles/com.apple.filesystems.userfsd/SD/Photos",
} as const;
const DEVICES = [
  { name: "mac", url: "/?store", root: "/Users/you/Pictures/Camera" },
  IPAD,
] as const satisfies { name: Device; url: string; root: string }[];

const TRIP = "2026-09-03_zell-am-see";
const LANDSCAPES = "2026-09-03_landscapes";

const dataUrl = (type: string, bytes: Buffer) =>
  `data:${type};base64,${bytes.toString("base64")}`;
const photo = (src: string) =>
  dataUrl("image/jpeg", readFileSync(`e2e/store/${src}`));

async function capture(
  browser: Browser,
  device: (typeof DEVICES)[number],
  viewport: Size,
  deviceScaleFactor: number,
  shoot: string,
  steps: (page: Page) => Promise<void>,
): Promise<Buffer> {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  await openShoot(page, shoot, device);
  await steps(page);
  // Out of the way of hover overlays, then wait out the image decodes.
  await page.mouse.move(2, viewport.height - 2);
  await page.waitForFunction(() =>
    [...document.images].every((image) => image.complete),
  );
  await page.waitForTimeout(500);
  // A photo without a committed preview is drawn instead; none may show.
  const drawn = await page.evaluate(() =>
    [...document.images]
      .filter((image) => {
        if (!image.src.startsWith("data:image/svg")) return false;
        const r = image.getBoundingClientRect();
        const xs = [r.left + 2, (r.left + r.right) / 2, r.right - 2];
        const ys = [r.top + 2, (r.top + r.bottom) / 2, r.bottom - 2];
        return xs.some((x) =>
          ys.some((y) => document.elementFromPoint(x, y) === image),
        );
      })
      .map(
        (image) =>
          image.closest("[data-path]")?.getAttribute("data-path") ?? image.alt,
      ),
  );
  expect(drawn).toEqual([]);
  const shot = await page.screenshot();
  await context.close();
  return shot;
}

async function compose(
  browser: Browser,
  out: string,
  list: Asset[],
  captures: Partial<Record<Capture, Buffer>>,
) {
  const css = readFileSync("e2e/store/template.css", "utf8");
  const icon = dataUrl(
    "image/png",
    readFileSync("../../brand/macos/icon-dark-1024.png"),
  );
  mkdirSync(out, { recursive: true });
  const page = await browser.newPage();
  for (const { file, size, frame } of list) {
    const shot = frame.capture && captures[frame.capture];
    if (frame.capture && !shot) throw new Error(`no ${frame.capture} capture`);
    await page.setViewportSize(size);
    await page.setContent(
      framePage(size, frame, css, {
        photo,
        capture: shot ? dataUrl("image/png", shot) : undefined,
        icon,
      }),
    );
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${out}/${file}` });
  }
  await page.close();
}

async function sortByInstinct(page: Page) {
  await page.getByTestId("sort").click();
  await page.getByTestId("sort-score").click();
  await page.keyboard.press("Escape");
}

async function selectKeepers(page: Page) {
  await page.getByTestId("hist-4").click();
  await page.getByTestId("open-export").click();
  await page.getByTestId("select-filtered").click();
}

async function loupeOnBlueHour(page: Page) {
  await page.getByTestId("hist-5").click();
  await page.getByTestId("thumb").first().click();
  await expect(page.getByTestId("loupe")).toBeVisible();
  for (let i = 0; i < 3; i += 1) await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("loupe-name")).toHaveText("DSC04417.ARW");
  // The histogram decodes its own copy of the render, outside the image wait.
  await expect(page.getByTestId("curve-histogram")).toBeAttached();
}

for (const device of DEVICES) {
  const size = SIZES[device.name];

  test(`@store ${device.name}`, async ({ browser }) => {
    test.setTimeout(180_000);
    const shoot = (name: string, steps: (page: Page) => Promise<void>) =>
      capture(
        browser,
        device,
        { width: size.width / 2, height: size.height / 2 },
        2,
        name,
        steps,
      );
    const captures: Partial<Record<Capture, Buffer>> = {
      "loupe-DSC03455": await shoot(TRIP, async (page) => {
        await page.getByTestId("hist-4").click();
        await page
          .locator('[data-testid=thumb][data-path="DSC03455.ARW"]')
          .click();
        await expect(page.getByTestId("loupe-name")).toHaveText("DSC03455.ARW");
      }),
      "nature-keepers-selected": await shoot(LANDSCAPES, async (page) => {
        await selectKeepers(page);
        await page.getByTestId("drawer-close").click();
        await expect(page.getByTestId("selection-count")).toHaveText(
          "34 selected",
        );
      }),
      "nature-export": await shoot(LANDSCAPES, async (page) => {
        await selectKeepers(page);
        await expect(page.getByTestId("drawer-count")).toHaveText("34");
      }),
      "nature-grid-instinct-3up": await shoot(LANDSCAPES, async (page) => {
        await sortByInstinct(page);
        await page.getByTestId("hist-3").click();
      }),
      "loupe-DSC04417": await shoot(LANDSCAPES, loupeOnBlueHour),
    };
    await compose(
      browser,
      `store-screenshots/${device.name}`,
      frames(device.name).map((frame, i) => ({
        file: `0${i + 1}.png`,
        size,
        frame,
      })),
      captures,
    );
  });
}

test("@store creative", async ({ browser }) => {
  test.setTimeout(120_000);
  // 3:2 like the search asset, with the sidebar away so the editor fills it.
  const editor = await capture(
    browser,
    IPAD,
    { width: 1200, height: 800 },
    4,
    LANDSCAPES,
    async (page) => {
      await loupeOnBlueHour(page);
      await page.keyboard.press("ControlOrMeta+b");
      await expect(
        page.locator("[data-slot=sidebar][data-state=collapsed]"),
      ).toBeAttached();
    },
  );
  await compose(browser, "store-screenshots/creative", CREATIVE_ASSETS, {
    "ipad-editor": editor,
  });
});
