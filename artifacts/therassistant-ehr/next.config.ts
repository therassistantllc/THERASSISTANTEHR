// File: artifacts/therassistant-ehr/next.config.ts
import type { NextConfig } from "next";

// The app is viewed through Replit's proxied iframe, which is served from a
// different origin than the dev server (e.g. `<id>.worf.replit.dev`). Next.js
// blocks cross-origin requests to its dev resources (`/_next/*`) unless the
// origin is allowlisted here. Wildcards only match a single subdomain label,
// so the exact current host is added explicitly from the environment.
const replitDevDomain = process.env.REPLIT_DEV_DOMAIN;

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: false,
  },
  experimental: {
    webpackMemoryOptimizations: true,
  },
  allowedDevOrigins: [
    "*.janeway.replit.dev",
    "*.worf.replit.dev",
    "*.replit.dev",
    "*.repl.co",
    ...(replitDevDomain ? [replitDevDomain] : []),
  ],
};

export default nextConfig;
