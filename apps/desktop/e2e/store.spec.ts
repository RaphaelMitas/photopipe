import { mkdirSync, readFileSync } from "node:fs";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { openShoot } from "./open-shoot";
import {
  type Capture,
  type Device,
  framePage,
  frames,
  SIZES,
} from "./store/frames";

// The App Store screenshots: the real UI against the e2e mock in `?store`
// mode, with the maker's own photos from e2e/store, framed by store/frames.ts.
// Tagged @store: `pnpm store-screenshots` runs only these, and the release
// uploads what they write to store-screenshots/.

const DEVICES = [
  {
    name: "mac",
    url: "/?store",
    root: "/Users/you/Pictures/Camera",
  },
  {
    name: "ipad",
    url: "/?store&ipad",
    root: "/private/var/mobile/Library/LiveFiles/com.apple.filesystems.userfsd/SD/Photos",
  },
] as const satisfies { name: Device; url: string; root: string }[];

const TRIP = "2026-09-03_zell-am-see";
const LANDSCAPES = "2026-09-03_landscapes";

const dataUrl = (type: string, bytes: Buffer) =>
  `data:${type};base64,${bytes.toString("base64")}`;
const photo = (src: string) =>
  dataUrl("image/jpeg", readFileSync(`e2e/store/${src}`));

for (const device of DEVICES) {
  const { width, height } = SIZES[device.name];

  async function capture(
    browser: Browser,
    shoot: string,
    steps: (page: Page) => Promise<void>,
  ): Promise<Buffer> {
    const context = await browser.newContext({
      viewport: { width: width / 2, height: height / 2 },
      deviceScaleFactor: 2,
      colorScheme: "dark",
    });
    const page = await context.newPage();
    await openShoot(page, shoot, device);
    await steps(page);
    // Out of the way of hover overlays, then wait out the image decodes.
    await page.mouse.move(2, height / 2 - 2);
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
            image.closest("[data-path]")?.getAttribute("data-path") ??
            image.alt,
        ),
    );
    expect(drawn).toEqual([]);
    const shot = await page.screenshot();
    await context.close();
    return shot;
  }

  async function sortByInstinct(page: Page) {
    await page.getByTestId("sort").click();
    await page.getByTestId("sort-score").click();
    await page.keyboard.press("Escape");
  }

  test(`@store ${device.name}`, async ({ browser }) => {
    test.setTimeout(180_000);
    const captures: Record<Capture, Buffer> = {
      "loupe-DSC03455": await capture(browser, TRIP, async (page) => {
        await page.getByTestId("hist-4").click();
        await page
          .locator('[data-testid=thumb][data-path="DSC03455.ARW"]')
          .click();
        await expect(page.getByTestId("loupe-name")).toHaveText("DSC03455.ARW");
      }),
      "nature-keepers-selected": await capture(
        browser,
        LANDSCAPES,
        async (page) => {
          await page.getByTestId("hist-4").click();
          await page.getByTestId("open-export").click();
          await page.getByTestId("select-filtered").click();
          await page.getByTestId("drawer-close").click();
          await expect(page.getByTestId("selection-count")).toHaveText(
            "34 selected",
          );
        },
      ),
      "nature-export": await capture(browser, LANDSCAPES, async (page) => {
        await page.getByTestId("hist-4").click();
        await page.getByTestId("open-export").click();
        await page.getByTestId("select-filtered").click();
        await expect(page.getByTestId("drawer-count")).toHaveText("34");
      }),
      "nature-grid-instinct-3up": await capture(
        browser,
        LANDSCAPES,
        async (page) => {
          await sortByInstinct(page);
          await page.getByTestId("hist-3").click();
        },
      ),
      "loupe-DSC04417": await capture(browser, LANDSCAPES, async (page) => {
        await page.getByTestId("hist-5").click();
        await page.getByTestId("thumb").first().click();
        await expect(page.getByTestId("loupe")).toBeVisible();
        for (let i = 0; i < 3; i += 1) await page.keyboard.press("ArrowRight");
        await expect(page.getByTestId("loupe-name")).toHaveText("DSC04417.ARW");
      }),
    };

    const css = readFileSync("e2e/store/template.css", "utf8");
    const icon = dataUrl(
      "image/png",
      readFileSync("../../brand/macos/icon-dark-1024.png"),
    );
    const out = `store-screenshots/${device.name}`;
    mkdirSync(out, { recursive: true });
    const page = await browser.newPage({ viewport: { width, height } });
    for (const [i, frame] of frames(device.name).entries()) {
      await page.setContent(
        framePage(device.name, frame, css, {
          photo,
          capture: dataUrl("image/png", captures[frame.capture]),
          icon,
        }),
      );
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${out}/0${i + 1}.png` });
    }
    await page.close();
  });
}
