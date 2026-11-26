import type { NextConfig } from "next";
import { SCREENSHOT_WIDTHS } from "./src/lib/screenshot-widths";

const config: NextConfig = {
  output: "export",
  transpilePackages: ["@photopipe/ui"],
  agentRules: false,
  images: {
    loader: "custom",
    loaderFile: "./src/lib/screenshot-loader.ts",
    deviceSizes: [...SCREENSHOT_WIDTHS],
    imageSizes: [],
  },
};

export default config;
