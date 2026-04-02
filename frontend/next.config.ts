import type { NextConfig } from "next";
import { createMDX } from "fumadocs-mdx/next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "workoscdn.com",
        pathname: "/**",
      },
    ],
  },
};

const withMDX = createMDX();

export default withMDX(nextConfig);
