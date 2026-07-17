-- Auth part 4: email+password becomes the default sign-in; passwordless
-- magic-link login is retained as a per-account opt-in.
--
-- Motivation: every magic-link/OTP sign-in sends an email, which burns email
-- quota and has a cost. Password sign-in and password sign-up (with
-- enable_confirmations = false) send no email, so they are the default. Magic
-- link stays available only for accounts that explicitly opt in.

-- Per-account opt-in flag. Default false → new accounts are password-only until
-- the user turns this on in account settings. Covered by the existing
-- "own profile" RLS policy (FOR ALL, auth.uid() = id), so no policy change.
ALTER TABLE profiles ADD COLUMN magic_link_enabled BOOLEAN NOT NULL DEFAULT false;

-- Server-side gate for sending a magic link. The sign-in page can't know who the
-- visitor is before they authenticate, so the "email me a link" request hits our
-- server, which calls this to decide whether an OTP may be sent for that address.
--
-- Returns true only when an account with that (case-insensitive) email exists AND
-- has opted in. SECURITY DEFINER so it can read auth.users (the caller can't).
-- Granted to service_role ONLY — never anon — so it is unreachable from the
-- browser and can't be used to enumerate which emails exist or opted in.
CREATE OR REPLACE FUNCTION public.magic_link_allowed(p_email text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    JOIN public.profiles p ON p.id = u.id
    WHERE lower(u.email) = lower(p_email)
      AND p.magic_link_enabled
  );
$$;

REVOKE ALL ON FUNCTION public.magic_link_allowed(text) FROM public;
GRANT EXECUTE ON FUNCTION public.magic_link_allowed(text) TO service_role;
