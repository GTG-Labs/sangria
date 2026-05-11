import type { NextConfig } from "next";
import { createMDX } from "fumadocs-mdx/next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  devIndicators: false,

  experimental: {
    // Enable CSP nonce support
    optimizeCss: true,
  },

  // Security headers (CSP is handled in middleware.ts with nonces)
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // X-Frame-Options removed - redundant with frame-ancestors 'none' in CSP
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ];
  },

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
