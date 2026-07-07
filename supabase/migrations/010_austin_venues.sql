-- Phase 2B: ~50 Austin T3 venue sources — the coverage payload that makes the
-- app "feel complete to a local" (PRODUCT-SPEC §1.1). Each is a DB row, not a
-- parser: adding/removing a venue is an INSERT/UPDATE, never a code change.
--
-- These URLs are the launch set. Some will 404 or block the light fetcher —
-- that's expected and SAFE: the crawler returns [] on failure and the source is
-- recorded as a zero-event ok/error run in source_runs, visible in
-- /api/admin/health for ops to prune or fix (a DB UPDATE, not a code change).
-- `notes = 'venue'` tags them for that ops filtering. Names follow the
-- crawl:<hostSlug> convention; for brand-new venues (no ingest history) the name
-- only needs to be unique.
INSERT INTO sources (name, kind, url, parser, cadence, notes) VALUES
  -- Live music clubs & halls
  ('crawl:mohawkaustin-com',        'crawl', 'https://mohawkaustin.com/calendar/', 'crawl', 'daily',  'venue'),
  ('crawl:theparishaustin-com',     'crawl', 'https://theparishaustin.com/calendar/', 'crawl', 'daily', 'venue'),
  ('crawl:continentalclub-com',     'crawl', 'https://continentalclub.com/', 'crawl', 'weekly', 'venue'),
  ('crawl:antonesnightclub-com',    'crawl', 'https://antonesnightclub.com/calendar/', 'crawl', 'daily', 'venue'),
  ('crawl:emosaustin-com',          'crawl', 'https://www.emosaustin.com/shows', 'crawl', 'daily', 'venue'),
  ('crawl:stubbsaustin-com',        'crawl', 'https://www.stubbsaustin.com/calendar/', 'crawl', 'daily', 'venue'),
  ('crawl:scootinnaustin-com',      'crawl', 'https://scootinnaustin.com/events/', 'crawl', 'daily', 'venue'),
  ('crawl:c-boys-com',              'crawl', 'https://www.c-boys.com/', 'crawl', 'weekly', 'venue'),
  ('crawl:saharalounge-com',        'crawl', 'https://www.saharalounge.com/', 'crawl', 'weekly', 'venue'),
  ('crawl:elephantroom-com',        'crawl', 'https://elephantroom.com/', 'crawl', 'weekly', 'venue'),
  ('crawl:thewhitehorseaustin-com', 'crawl', 'https://www.thewhitehorseaustin.com/', 'crawl', 'weekly', 'venue'),
  ('crawl:texashotelvegas-com',     'crawl', 'https://www.texashotelvegas.com/', 'crawl', 'weekly', 'venue'),
  ('crawl:cheerupcharlies-com',     'crawl', 'https://cheerupcharlies.com/', 'crawl', 'weekly', 'venue'),
  ('crawl:radioeast-co',            'crawl', 'https://www.radioeast.co/', 'crawl', 'weekly', 'venue'),
  ('crawl:empireatx-com',           'crawl', 'https://empireatx.com/calendar/', 'crawl', 'daily', 'venue'),
  ('crawl:sagebrushtexas-com',      'crawl', 'https://www.sagebrushtexas.com/', 'crawl', 'weekly', 'venue'),
  ('crawl:brokenspokeaustintx-net', 'crawl', 'https://brokenspokeaustintx.net/', 'crawl', 'weekly', 'venue'),
  ('crawl:donsdepot-net',           'crawl', 'https://www.donsdepot.net/', 'crawl', 'weekly', 'venue'),
  ('crawl:evangelinecafe-com',      'crawl', 'https://www.evangelinecafe.com/music', 'crawl', 'weekly', 'venue'),
  ('crawl:guerostacobar-com',       'crawl', 'https://www.guerostacobar.com/music/', 'crawl', 'weekly', 'venue'),
  ('crawl:thetavernaustin-com',     'crawl', 'https://www.thetavernaustin.com/', 'crawl', 'weekly', 'venue'),
  -- Concert halls / amphitheaters / performing arts
  ('crawl:austintheatre-org',       'crawl', 'https://www.austintheatre.org/events/', 'crawl', 'daily', 'venue'),
  ('crawl:themoodyamphitheater-com','crawl', 'https://www.themoodyamphitheater.com/events', 'crawl', 'daily', 'venue'),
  ('crawl:acl-live-com',            'crawl', 'https://www.acl-live.com/calendar', 'crawl', 'daily', 'venue'),
  ('crawl:3ten-acl-live-com',       'crawl', 'https://www.acl-live.com/3ten/calendar', 'crawl', 'daily', 'venue'),
  ('crawl:thelongcenter-org',       'crawl', 'https://thelongcenter.org/events/', 'crawl', 'daily', 'venue'),
  ('crawl:germaniainsurancetheater-com','crawl', 'https://www.germaniainsurancetheater.com/events', 'crawl', 'daily', 'venue'),
  ('crawl:texasperformingarts-org', 'crawl', 'https://texasperformingarts.org/calendar', 'crawl', 'daily', 'venue'),
  ('crawl:austinsymphony-org',      'crawl', 'https://austinsymphony.org/concerts/', 'crawl', 'weekly', 'venue'),
  -- Comedy & theater
  ('crawl:capcitycomedy-com',       'crawl', 'https://www.capcitycomedy.com/', 'crawl', 'weekly', 'venue'),
  ('crawl:coldtownetheater-com',    'crawl', 'https://coldtownetheater.com/shows', 'crawl', 'weekly', 'venue'),
  ('crawl:fallouttheater-com',      'crawl', 'https://fallouttheater.com/shows/', 'crawl', 'weekly', 'venue'),
  ('crawl:zachtheatre-org',         'crawl', 'https://www.zachtheatre.org/shows/', 'crawl', 'daily', 'venue'),
  ('crawl:hydeparktheatre-org',     'crawl', 'https://hydeparktheatre.org/', 'crawl', 'weekly', 'venue'),
  ('crawl:vortexrep-org',           'crawl', 'https://www.vortexrep.org/upcoming', 'crawl', 'weekly', 'venue'),
  -- Museums, galleries, gardens, family
  ('crawl:thecontemporaryaustin-org','crawl', 'https://thecontemporaryaustin.org/whats-on/', 'crawl', 'weekly', 'venue'),
  ('crawl:blantonmuseum-org',       'crawl', 'https://blantonmuseum.org/events/', 'crawl', 'weekly', 'venue'),
  ('crawl:thinkeryaustin-org',      'crawl', 'https://thinkeryaustin.org/visit/calendar/', 'crawl', 'weekly', 'venue'),
  ('crawl:zilkergarden-org',        'crawl', 'https://zilkergarden.org/events/', 'crawl', 'weekly', 'venue'),
  ('crawl:umlaufsculpture-org',     'crawl', 'https://www.umlaufsculpture.org/events', 'crawl', 'weekly', 'venue'),
  ('crawl:shalomaustin-org',        'crawl', 'https://www.shalomaustin.org/events', 'crawl', 'weekly', 'venue'),
  -- Civic / library / markets / districts
  ('crawl:library-austintexas-gov', 'crawl', 'https://library.austintexas.gov/events', 'crawl', 'daily', 'venue'),
  ('crawl:centralmarket-com',       'crawl', 'https://www.centralmarket.com/events', 'crawl', 'weekly', 'venue'),
  ('crawl:muelleraustin-com',       'crawl', 'https://www.muelleraustin.com/events/', 'crawl', 'weekly', 'venue'),
  ('crawl:simon-com-the-domain',    'crawl', 'https://www.simon.com/mall/the-domain/events', 'crawl', 'weekly', 'venue'),
  -- Sports
  ('crawl:austinfc-com',            'crawl', 'https://www.austinfc.com/schedule/', 'crawl', 'weekly', 'venue'),
  ('crawl:texassports-com',         'crawl', 'https://texassports.com/calendar', 'crawl', 'weekly', 'venue'),
  ('crawl:roundrockexpress-com',    'crawl', 'https://www.milb.com/round-rock/schedule', 'crawl', 'weekly', 'venue'),
  -- Breweries / outdoor / misc gathering spots
  ('crawl:meanwhilebrewing-com',    'crawl', 'https://www.meanwhilebeer.com/events', 'crawl', 'weekly', 'venue'),
  ('crawl:stillaustin-com',         'crawl', 'https://stillaustin.com/pages/events', 'crawl', 'weekly', 'venue'),
  ('crawl:thefarout-com',           'crawl', 'https://www.thefarout.com/events', 'crawl', 'daily', 'venue');
