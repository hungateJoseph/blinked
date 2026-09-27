import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 and sharp are native (C++) modules. Telling Next.js to
  // leave them as normal Node `require`s — instead of bundling them — is what
  // makes them work, in development and inside the Docker image.
  serverExternalPackages: ["better-sqlite3", "sharp"],

  // Build a self-contained server in .next/standalone, so the Docker image
  // only needs that plus the native modules — not the whole node_modules tree.
  output: "standalone",
};

export default nextConfig;
