import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentUpgrade: "security",
  },
  cacheComponents: true,
  partialPrefetching: true,
  // Hide the bottom-left "N" route indicator in development; build/runtime errors still show.
  devIndicators: false,
};

export default nextConfig;
