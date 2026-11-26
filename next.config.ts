import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: ["*.e2b.app"],
  experimental: { cpus: 2 },
  async rewrites() {
    return [
      {
        source: "/terminal-api/:path*",
        destination: `${process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000"}/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};
export default config;
