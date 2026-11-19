import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import type { NextConfig } from "next";
import versionConfig from "./version.json";
import { buildVersion } from "./src/lib/stark/version-policy.ts";

const version = buildVersion(versionConfig, process.env.STARK_BUILD_CHANNEL || "dev");

const lanDevOrigins = Object.values(networkInterfaces())
  .flatMap((interfaces) => interfaces ?? [])
  .filter(({ family, internal }) => family === "IPv4" && !internal)
  .map(({ address }) => address);

const showcaseDemoBuild = process.env.STARK_SHOWCASE_DEMO === "1";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_STARK_VERSION_NAME: version.versionName,
    NEXT_PUBLIC_STARK_VERSION_CODE: String(version.versionCode),
  },
  // Next.js 16 rejects HMR connections from a LAN address unless it is
  // explicitly trusted. Discover active local IPv4 addresses so a phone can
  // safely use the current development server without hard-coding one IP.
  allowedDevOrigins: lanDevOrigins,
  turbopack: {
    // The Web package links dependencies from the project-level pnpm store.
    // Keep that directory inside Turbopack's filesystem boundary so both dev
    // and production builds can resolve Next and its peer dependencies.
    root: resolve(process.cwd(), ".."),
  },
  reactStrictMode: true,
  devIndicators: false,
  ...(showcaseDemoBuild ? { basePath: process.env.NEXT_PUBLIC_APP_BASE_PATH || "/phone-demo" } : {}),
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
