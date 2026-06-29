import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.eventbrite.com' },
      { protocol: 'https', hostname: '**.eventbritecdn.com' },
      { protocol: 'https', hostname: '**.do512.com' },
      { protocol: 'https', hostname: '**.austinchronicle.com' },
    ],
  },
};

export default nextConfig;
