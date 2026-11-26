import { readdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import screenshotLoader, {
  SCREENSHOT_WIDTHS,
} from "../src/lib/screenshot-loader.ts";

const folder = "public/screenshots";
const screenshots = (await readdir(folder)).filter((file) =>
  file.endsWith(".jpg"),
);

await Promise.all(
  screenshots.flatMap((file) =>
    SCREENSHOT_WIDTHS.map((width) =>
      sharp(join(folder, file))
        .resize({ width })
        .webp({ quality: 80 })
        .toFile(screenshotLoader({ src: join(folder, file), width })),
    ),
  ),
);
