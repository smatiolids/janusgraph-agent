import type { NextConfig } from "next";
import path from "node:path";

const srcAliasPath = path.resolve(process.cwd(), "src");

const nextConfig: NextConfig = {
  typedRoutes: true,
  turbopack: {
    resolveAlias: {
      "@": srcAliasPath
    }
  },
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@": srcAliasPath
    };

    // Avoid webpack filesystem cache issues when running from npx temp installs.
    if (process.env.GRAPHX_AI_CLI === "1") {
      config.cache = false;
    }

    return config;
  }
};

export default nextConfig;
