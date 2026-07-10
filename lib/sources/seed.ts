import type { RawEvent } from './types'

// Seed source: real, recurring Austin venues/events with dates generated a few
// days into the future so the app is demonstrable with zero API keys. Live
// sources (Eventbrite, Chronicle, Do512, iCal) supplement these in production.
// Clearly labeled with source 'seed' so it can be excluded once live feeds flow.

function daysFromNow(days: number, hour: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}

type SeedDef = Omit<RawEvent, 'start_time' | 'end_time' | 'source' | 'source_id'> & {
  inDays: number
  hour: number
}

const SEED: SeedDef[] = [
  {
    title: 'The Marcus Webb Quartet',
    description: 'Nightly jazz in a downtown basement institution on Congress Ave. Marcus Webb (sax) leads a quartet through standards and originals.',
    venue_name: 'Elephant Room', venue_address: '315 Congress Ave, Austin',
    image_url: null, ticket_url: 'https://elephantroom.com', is_free: false, price_min: 10, price_max: 15,
    inDays: 2, hour: 21,
  },
  {
    title: 'Danny Ruiz Headlines Cap City',
    description: 'Touring headliner Danny Ruiz brings a full hour of new material, with local comics opening.',
    venue_name: 'Cap City Comedy Club', venue_address: '11506 Century Oaks Terrace, Austin',
    image_url: null, ticket_url: 'https://capcitycomedy.com', is_free: false, price_min: 20, price_max: 30,
    inDays: 3, hour: 20,
  },
  {
    title: 'Cactus Radio with Wilder Maine',
    description: 'Indie rock double bill on the iconic Red River outdoor stage: Cactus Radio headlines, Wilder Maine opens.',
    venue_name: 'Mohawk Austin', venue_address: '912 Red River St, Austin',
    image_url: null, ticket_url: 'https://mohawkaustin.com', is_free: false, price_min: 18, price_max: 25,
    inDays: 4, hour: 20,
  },
  {
    title: 'The Lonesome Ramblers Happy Hour Residency',
    description: 'Classic Austin honky-tonk and roots music on South Congress. The Lonesome Ramblers\' long-running weekly residency.',
    venue_name: 'The Continental Club', venue_address: '1315 S Congress Ave, Austin',
    image_url: null, ticket_url: 'https://continentalclub.com', is_free: true, price_min: null, price_max: null,
    inDays: 1, hour: 18,
  },
  {
    title: 'Terror Tuesday: The Fog (1980)',
    description: 'Cult and horror film screening with full food and drink service at the famous Austin theater.',
    venue_name: 'Alamo Drafthouse Ritz', venue_address: '320 E 6th St, Austin',
    image_url: null, ticket_url: 'https://drafthouse.com', is_free: false, price_min: 12, price_max: 12,
    inDays: 5, hour: 19,
  },
  {
    title: 'Barton Springs Morning Swim & Hike',
    description: 'Cold spring-fed pool and Greenbelt trails in Zilker Park. Great for an early outdoor start.',
    venue_name: 'Barton Springs Pool', venue_address: '2201 Barton Springs Rd, Austin',
    image_url: null, ticket_url: 'https://austintexas.gov/department/barton-springs-pool', is_free: false, price_min: 5, price_max: 9,
    inDays: 2, hour: 8,
  },
  {
    title: 'East Austin Food Truck & Craft Beer Crawl',
    description: 'Tacos, BBQ, and local breweries across the east side. A rotating lineup of Austin\'s best food trucks.',
    venue_name: 'East 6th Street', venue_address: 'E 6th St, Austin',
    image_url: null, ticket_url: null, is_free: true, price_min: null, price_max: null,
    inDays: 6, hour: 17,
  },
  {
    title: 'Sierra Kane Live at ACL Live',
    description: 'Touring headline act Sierra Kane at the home of Austin City Limits. Seated and standing GA.',
    venue_name: 'ACL Live at the Moody Theater', venue_address: '310 W Willie Nelson Blvd, Austin',
    image_url: null, ticket_url: 'https://acl-live.com', is_free: false, price_min: 45, price_max: 95,
    inDays: 7, hour: 20,
  },
  {
    title: 'Rosa Delgado: Modern Art Exhibition',
    description: 'Rotating exhibition of modern and contemporary art at UT\'s flagship museum, featuring painter Rosa Delgado.',
    venue_name: 'Blanton Museum of Art', venue_address: '200 E Martin Luther King Jr Blvd, Austin',
    image_url: null, ticket_url: 'https://blantonmuseum.org', is_free: false, price_min: 12, price_max: 12,
    inDays: 3, hour: 11,
  },
  {
    title: 'Zilker Park Family Day & Kids Activities',
    description: 'All-ages outdoor fun, games, and activities for families in Austin\'s signature park.',
    venue_name: 'Zilker Metropolitan Park', venue_address: '2100 Barton Springs Rd, Austin',
    image_url: null, ticket_url: null, is_free: true, price_min: null, price_max: null,
    inDays: 8, hour: 10,
  },
  {
    title: 'Austin Startup Founders Mixer & Networking',
    description: 'Monthly networking mixer for founders, engineers, and operators in the Austin tech scene.',
    venue_name: 'Capital Factory', venue_address: '701 Brazos St, Austin',
    image_url: null, ticket_url: null, is_free: true, price_min: null, price_max: null,
    inDays: 4, hour: 18,
  },
  {
    title: 'Saturday Farmers Market at Republic Square',
    description: 'Local produce, food vendors, and live music every weekend downtown.',
    venue_name: 'Republic Square', venue_address: '422 Guadalupe St, Austin',
    image_url: null, ticket_url: null, is_free: true, price_min: null, price_max: null,
    inDays: 5, hour: 9,
  },
]

export async function fetchSeedEvents(): Promise<RawEvent[]> {
  return SEED.map((s, i) => {
    const { inDays, hour, ...rest } = s
    return {
      ...rest,
      start_time: daysFromNow(inDays, hour),
      end_time: null,
      source: 'seed',
      source_id: `seed-${i}-${rest.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`,
    }
  })
}
