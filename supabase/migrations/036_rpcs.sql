-- Re-architecture part 3: the controlled doors through RLS.
--
-- Two things must reach past the per-user / authenticated-only policies:
--   1. Anonymous visitors need a *few* suggested events (the sign-up teaser) but
--      must never enumerate the full catalog.
--   2. A signed-in user's action must nudge the shared per-event engagement
--      aggregate, which no user owns (so no per-user policy can cover it).
-- Both are SECURITY DEFINER functions with a pinned search_path: they run as the
-- owner (bypassing RLS) but only ever do one narrow, safe thing.

-- ---------------------------------------------------------------------------
-- Anon teaser: a capped set of upcoming, approved events ranked by engagement.
-- Granted to anon (and authenticated). The LEAST(...) hard-caps the count so
-- this can never be used to page through the whole catalog. Embedding and other
-- internal columns are not returned.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_suggested_events(p_limit int DEFAULT 6)
RETURNS TABLE (
  id uuid, title text, description text, start_time timestamptz, end_time timestamptz,
  venue_name text, image_url text, ticket_url text, is_free boolean,
  price_min numeric, price_max numeric, city_id int, categories jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, e.title, e.description, e.start_time, e.end_time,
         e.venue_name, e.image_url, e.ticket_url, e.is_free,
         e.price_min, e.price_max, e.city_id,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object('slug', c.slug, 'name', c.name, 'color', c.color))
           FROM event_categories ec JOIN categories c ON c.id = ec.category_id
           WHERE ec.event_id = e.id
         ), '[]'::jsonb) AS categories
  FROM events e
  LEFT JOIN event_engagement ee ON ee.event_id = e.id
  WHERE e.status = 'approved' AND e.start_time >= now()
  ORDER BY COALESCE(ee.score, 0) DESC, e.start_time ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 6), 1), 12);
$$;

REVOKE ALL ON FUNCTION public.public_suggested_events(int) FROM public;
GRANT EXECUTE ON FUNCTION public.public_suggested_events(int) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shared engagement writes. The Bayesian-smoothed score is recomputed inline
-- with the same prior (strength 20, city rate 0.1) the app used in lib/db, so
-- trending stays write-through and real-time. Callers are signed-in users
-- (their own interaction / impression triggered it); the function only touches
-- the shared aggregate, never any user-owned row, so it's safe as DEFINER.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bump_impression(p_event_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO event_engagement (event_id, impressions, engagements, score)
  VALUES (p_event_id, 1, 0, (0 + 20 * 0.1) / (1 + 20))
  ON CONFLICT (event_id) DO UPDATE SET
    impressions = event_engagement.impressions + 1,
    score = (event_engagement.engagements + 20 * 0.1) / (event_engagement.impressions + 1 + 20),
    updated_at = now();
$$;

CREATE OR REPLACE FUNCTION public.bump_engagement(p_event_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO event_engagement (event_id, impressions, engagements, score)
  VALUES (p_event_id, 0, 1, (1 + 20 * 0.1) / (0 + 20))
  ON CONFLICT (event_id) DO UPDATE SET
    engagements = event_engagement.engagements + 1,
    score = (event_engagement.engagements + 1 + 20 * 0.1) / (event_engagement.impressions + 20),
    updated_at = now();
$$;

REVOKE ALL ON FUNCTION public.bump_impression(uuid) FROM public;
REVOKE ALL ON FUNCTION public.bump_engagement(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.bump_impression(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bump_engagement(uuid) TO authenticated;
