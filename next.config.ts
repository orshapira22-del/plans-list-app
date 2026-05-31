import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  // Static export — no server. All processing runs in the browser.
};

export default nextConfig;
