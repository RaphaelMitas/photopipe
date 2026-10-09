import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@photopipe/ui"],
  agentRules: false,
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/",
          has: [{ type: "header", key: "accept", value: ".*text/markdown.*" }],
          destination: "/llms-full.txt",
        },
      ],
    };
  },
  async headers() {
    return [
      {
        source: "/",
        headers: [
          {
            key: "Link",
            value: '</llms-full.txt>; rel="alternate"; type="text/markdown"',
          },
        ],
      },
    ];
  },
};

export default config;
