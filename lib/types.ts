// The app's shared domain types — one definition each. (Formerly split between
// lib/supabase/types.ts and four verbatim copies of EnrichedEvent in the UI.)

export type Category = {
  id: number
  slug: string
  name: string
  color: string
}

export type Event = {
  id: string
  title: string
  description: string | null
  start_time: string
  end_time: string | null
  venue_name: string | null
  venue_address: string | null
  image_url: string | null
  ticket_url: string | null
  source: string
  source_id: string | null
  is_free: boolean
  price_min: number | null
  price_max: number | null
  created_at: string
  updated_at: string
  categories?: Category[]
  is_featured?: boolean
  featured_label?: string | null
}

// An event with its joined categories and resolved featured state — what every
// read path in lib/db returns and every card/list/calendar consumes.
export type EnrichedEvent = Event & {
  categories?: Category[]
  is_featured?: boolean
  featured_label?: string | null
}

export type Subscription = {
  id: string
  email: string
  user_id: string | null
  frequency: 'daily' | 'weekly'
  category_slugs: string[]
  token: string
  confirmed: boolean
  created_at: string
}

export type FeaturedListing = {
  id: string
  event_id: string
  starts_at: string
  ends_at: string
  ad_label: string
}
