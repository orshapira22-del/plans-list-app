import type { NextConfig } from "next";

// For GitHub Pages project sites the app is served from /<repo>.
// Set BASE_PATH=/plans-list-app in CI. For a custom domain leave it empty.
const basePath = process.env.BASE_PATH || "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  assetPrefix: basePath || undefined,
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
