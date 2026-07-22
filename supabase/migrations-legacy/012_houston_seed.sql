-- Phase 3 playbook proof: Houston as the second Texas city. T1 (Ticketmaster +
-- SeatGeek, geo-parametrized by lib/sources/ticketmaster.ts/seatgeek.ts — see
-- migration 011's companion code changes) + T2 (city calendar) + T3 (~27 venue
-- crawl sources) across the same genre spread as the Austin seed (migration
-- 010). Some URLs will 404 or block the light fetcher, exactly as with Austin
-- — that's expected and safe: /api/admin/health surfaces zero-event sources
-- for ops to prune or fix without a code change.
INSERT INTO cities (slug, name, state, timezone, enabled) VALUES
  ('houston', 'Houston', 'TX', 'America/Chicago', true);

-- T1: structured APIs, geo-parametrized. Distinct source names (sources.name
-- is UNIQUE); same `parser` dispatches to the same code mechanism as Austin.
INSERT INTO sources (city_id, name, kind, url, parser) VALUES
  ((SELECT id FROM cities WHERE slug = 'houston'), 'ticketmaster:houston', 'api', NULL, 'ticketmaster'),
  ((SELECT id FROM cities WHERE slug = 'houston'), 'seatgeek:houston',     'api', NULL, 'seatgeek');

-- T2: city calendar.
INSERT INTO sources (city_id, name, kind, url, parser) VALUES
  ((SELECT id FROM cities WHERE slug = 'houston'), 'houston-gov', 'ical', 'https://www.houstontx.gov/calendar.ical', 'ical');

-- T3: venue-direct crawl sources.
INSERT INTO sources (city_id, name, kind, url, parser, cadence, notes) VALUES
  -- Live music clubs & halls
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:houseofblues-com-houston',    'crawl', 'https://www.houseofblues.com/houston',       'crawl', 'daily',  'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:whiteoakmusichall-com',       'crawl', 'https://whiteoakmusichall.com/calendar/',    'crawl', 'daily',  'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:warehouselive-com',           'crawl', 'https://www.warehouselive.com/events/',      'crawl', 'daily',  'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:theheightstheater-com',       'crawl', 'https://www.theheightstheater.com/events',   'crawl', 'daily',  'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:continentalclub-com-houston', 'crawl', 'https://continentalclub.com/houston',        'crawl', 'weekly', 'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:rockefellershouston-com',     'crawl', 'https://www.rockefellershouston.com/events', 'crawl', 'weekly', 'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:numbershouston-com',          'crawl', 'https://numbershouston.com/',                'crawl', 'weekly', 'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:scoutbar-net',                'crawl', 'https://www.scoutbar.net/events',            'crawl', 'weekly', 'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:713musichall-com',            'crawl', 'https://713musichall.com/events/',           'crawl', 'daily',  'venue'),
  -- Concert halls / amphitheaters / performing arts
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:woodlandscenter-org',    'crawl', 'https://www.woodlandscenter.org/events',    'crawl', 'daily',  'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:thehobbycenter-org',     'crawl', 'https://www.thehobbycenter.org/events',     'crawl', 'daily',  'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:worthamcenter-org',      'crawl', 'https://www.worthamcenter.org/events/',     'crawl', 'daily',  'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:milleroutdoortheatre-com','crawl', 'https://www.milleroutdoortheatre.com/events','crawl', 'daily',  'venue'),
  -- Comedy & theater
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:thesecretgroup-com', 'crawl', 'https://thesecretgroup.com/shows/',  'crawl', 'weekly', 'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:houston-improv-com','crawl', 'https://houston.improv.com/shows',   'crawl', 'weekly', 'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:alleytheatre-org',  'crawl', 'https://www.alleytheatre.org/whats-on', 'crawl', 'weekly', 'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:stageshouston-com','crawl', 'https://www.stageshouston.com/whats-on', 'crawl', 'weekly', 'venue'),
  -- Museums, galleries, family
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:hmns-org',           'crawl', 'https://www.hmns.org/events/',              'crawl', 'weekly', 'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:cmhouston-org',      'crawl', 'https://www.cmhouston.org/visit/calendar/', 'crawl', 'weekly', 'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:houstonzoo-org',     'crawl', 'https://www.houstonzoo.org/events/',        'crawl', 'weekly', 'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:discoverygreen-com','crawl', 'https://www.discoverygreen.com/events',      'crawl', 'daily',  'venue'),
  -- Civic / library
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:houstonlibrary-org', 'crawl', 'https://houstonlibrary.org/events', 'crawl', 'daily', 'venue'),
  -- Sports
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:mlb-com-astros',      'crawl', 'https://www.mlb.com/astros/schedule',       'crawl', 'weekly', 'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:nba-com-rockets',     'crawl', 'https://www.nba.com/rockets/schedule',      'crawl', 'weekly', 'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:houstondynamofc-com','crawl', 'https://www.houstondynamofc.com/schedule/', 'crawl', 'weekly', 'venue'),
  -- Breweries / outdoor / misc
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:saintarnold-com',  'crawl', 'https://saintarnold.com/events/',    'crawl', 'weekly', 'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:buffalobayou-org','crawl', 'https://buffalobayou.org/events/',   'crawl', 'weekly', 'venue');
