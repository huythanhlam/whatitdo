-- Grant table privileges to the Supabase API roles.
-- Required when "permission denied for table ..." appears even with the
-- service_role key: RLS policies control row access, but the roles still need
-- base table GRANTs underneath them.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- service_role (server-side, bypasses RLS) needs full access
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- anon + authenticated need read access (public event browsing); writes are
-- still gated by the RLS policies from 001/002/003.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- Apply the same grants automatically to any tables created later.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO service_role;
