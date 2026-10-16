import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The backend URL is read server-side only (no NEXT_PUBLIC_ prefix), so it never reaches the browser bundle.
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
