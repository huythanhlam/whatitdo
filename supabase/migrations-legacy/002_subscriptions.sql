CREATE TABLE subscriptions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT NOT NULL,
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  frequency      TEXT NOT NULL DEFAULT 'daily',
  category_slugs TEXT[] DEFAULT '{}',
  token          TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  confirmed      BOOLEAN DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(email)
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages subscriptions" ON subscriptions FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Users read own subscriptions" ON subscriptions FOR SELECT USING (auth.uid() = user_id);
