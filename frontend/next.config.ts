import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The backend URL is read server-side only (no NEXT_PUBLIC_ prefix), so it never reaches the browser bundle.
  reactStrictMode: true,
  poweredByHeader: false,
  // Playwright addresses the dev server as 127.0.0.1. Next 16 blocks that host's dev resources unless it is named.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
