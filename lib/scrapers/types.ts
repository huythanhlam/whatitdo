export type RawEvent = {
  title: string
  description: string | null
  start_time: string
  end_time: string | null
  venue_name: string | null
  venue_address: string | null
  image_url: string | null
  ticket_url: string | null
  source: string
  source_id: string
  is_free: boolean
  price_min: number | null
  price_max: number | null
}
