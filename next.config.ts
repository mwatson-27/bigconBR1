import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // "export" produces a fully static site under `out/` — no Node server needed.
  // Perfect for Render.com Static Sites, Cloudflare Pages, Vercel static, S3, etc.
  output: "export",
  // Disable the Image Optimization API (it requires a server).
  images: {
    unoptimized: true,
  },
  // Generate /foo/index.html for every route so static hosts don't need
  // URL rewriting.
  trailingSlash: true,
  // We don't need strict TS during static export — the existing project
  // already ignores build errors.
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
