import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@photopipe/ui"],
  agentRules: false,
};

export default config;
