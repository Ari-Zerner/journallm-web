import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Increase serverless function timeout for Claude API calls
  serverExternalPackages: ["@anthropic-ai/sdk"],
};

export default nextConfig;
