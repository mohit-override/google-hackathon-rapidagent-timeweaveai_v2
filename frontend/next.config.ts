import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // Disable ESLint check during production build to save memory/CPU
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Disable TypeScript errors during build to save memory/CPU
    ignoreBuildErrors: true,
  },
  experimental: {
    webpackBuildWorker: true,
    webpackMemoryOptimizations: true,
  }
};

export default nextConfig;
