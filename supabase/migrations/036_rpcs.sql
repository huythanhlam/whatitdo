-- Re-architecture part 3: controlled writes to the shared engagement aggregate.
--
-- event_engagement is per-event metadata (not user-private, so no per-user RLS),
-- but a user must be able to *nudge* it write-through on their own actions
-- without being able to write it arbitrarily (which would let one user skew the
-- counts that rank events for everyone). So the two writes are SECURITY DEFINER
-- functions with a pinned search_path: authenticated may call them, but they only
-- ever bump one event's counters — no direct table write grant is given.
--
-- The Bayesian-smoothed score is recomputed inline with the same prior
-- (strength 20, city rate 0.1) the app used in lib/db, so trending stays
-- write-through and real-time.

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
