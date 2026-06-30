import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // PGlite ships a WASM bundle that Next's bundler mangles; keep it external so
  // it loads via Node's native resolution. Only used in local (no-Supabase) mode.
  serverExternalPackages: ['@electric-sql/pglite'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.eventbrite.com' },
      { protocol: 'https', hostname: '**.eventbritecdn.com' },
      { protocol: 'https', hostname: '**.do512.com' },
      { protocol: 'https', hostname: '**.austinchronicle.com' },
      { protocol: 'https', hostname: 's1.ticketm.net' },
      { protocol: 'https', hostname: '**.ticketm.net' },
      { protocol: 'https', hostname: '**.seatgeek.com' },
      { protocol: 'https', hostname: '**.tmol.io' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
  },
};

export default nextConfig;
