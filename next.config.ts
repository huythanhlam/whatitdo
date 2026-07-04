import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // PGlite ships a WASM bundle that Next's bundler mangles; keep it external so
  // it loads via Node's native resolution. `pg` (the prod Postgres driver) also
  // has native/dynamic internals best left unbundled. One is used per deployment.
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
  // The migration runner reads supabase/migrations/*.sql at runtime; trace them
  // into the serverless bundle so the PGlite fallback finds them in production.
  outputFileTracingIncludes: {
    '/*': ['supabase/migrations/**/*'],
  },
  images: {
    // Event images come from many third-party hosts (ticketing platforms,
    // scraped venue pages, CDNs). Allow any https host so next/image never fails
    // on an unlisted source; the app already renders these URLs directly.
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
};

export default nextConfig;
