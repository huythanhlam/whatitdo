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
  async headers() {
    return [
      {
        // Every response — baseline hardening headers absent by default.
        source: '/:path*',
        headers: [
          // This app never frames itself into another site's UI, and has no
          // legitimate reason to be framed by one — block clickjacking.
          { key: 'X-Frame-Options', value: 'DENY' },
          // Stop browsers from MIME-sniffing a response into an executable
          // type (e.g. treating an uploaded/served asset as script).
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Don't leak the full referring URL (which can carry query params)
          // to third-party origins linked from event/ticket pages.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // No use for camera/mic/geolocation/etc. anywhere in the app.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // Ignored by browsers over plain HTTP (harmless in local dev);
          // forces HTTPS for a year including subdomains once served once
          // over HTTPS in production.
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ]
  },
};

export default nextConfig;
