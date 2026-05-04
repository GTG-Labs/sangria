import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Security headers. CSP is set in proxy.ts because it needs a per-request
  // nonce. X-Frame-Options is handled via CSP's `frame-ancestors 'none'`.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
