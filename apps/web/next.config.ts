import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  poweredByHeader: false,
  reactStrictMode: true,
  // The manual sync route consumes the worker's guarded entrypoint. Keep it
  // in Next's compilation graph so a workspace install never relies on a
  // stale ignored worker dist directory.
  transpilePackages: ["@real2/domain", "@real2/worker"],
};

export default nextConfig;
