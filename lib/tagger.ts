import { GoogleGenAI } from '@google/genai'
import { CATEGORY_SLUGS, type CategorySlug } from './categories'

const apiKey = process.env.GEMINI_API_KEY
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null

// Keyword fallback so events are always tagged, even without a Gemini key
// configured. Order matters only for readability — all matches are collected.
const KEYWORD_RULES: { slug: CategorySlug; patterns: RegExp }[] = [
  { slug: 'music',      patterns: /\b(concert|live music|band|dj|gig|acoustic|orchestra|symphony|hip[- ]?hop|jazz|rock|indie|tour|residency|setlist)\b/i },
  { slug: 'comedy',     patterns: /\b(comedy|stand[- ]?up|standup|improv|open mic|sketch|comedian)\b/i },
  { slug: 'food-drink', patterns: /\b(food|drink|dinner|brunch|tasting|wine|beer|cocktail|happy hour|bbq|barbecue|culinary|chef|pop[- ]?up|brewery|distillery|coffee|taco)\b/i },
  { slug: 'arts',       patterns: /\b(art|gallery|exhibit|exhibition|museum|theatre|theater|dance|ballet|opera|poetry|painting|sculpture|craft)\b/i },
  { slug: 'sports',     patterns: /\b(game|match|tournament|race|marathon|5k|10k|soccer|basketball|baseball|football|fc|united|fitness|yoga|cycling|run club)\b/i },
  { slug: 'family',     patterns: /\b(family|kids|children|toddler|all ages|story ?time|petting zoo|family[- ]?friendly)\b/i },
  { slug: 'festivals',  patterns: /\b(festival|fest|fair|carnival|celebration|market|parade)\b/i },
  { slug: 'film',       patterns: /\b(film|movie|screening|cinema|documentary|premiere|drafthouse)\b/i },
  { slug: 'outdoors',   patterns: /\b(hike|hiking|outdoor|park|trail|nature|kayak|paddle|garden|greenbelt|lake|camping)\b/i },
  { slug: 'networking', patterns: /\b(network|networking|meetup|mixer|conference|workshop|summit|panel|startup|founder|professional|career|hackathon)\b/i },
]

export function tagByKeyword(title: string, description: string | null): CategorySlug[] {
  const haystack = `${title} ${description ?? ''}`
  const matches = KEYWORD_RULES.filter(r => r.patterns.test(haystack)).map(r => r.slug)
  return matches.length > 0 ? matches.slice(0, 3) : ['other']
}

export async function tagEvent(title: string, description: string | null): Promise<CategorySlug[]> {
  // No Gemini key configured → deterministic keyword tagging.
  if (!ai) return tagByKeyword(title, description)

  const prompt = `You are categorizing Austin, TX events. Given an event title and description, return a JSON array of category slugs that apply.

Available slugs: ${CATEGORY_SLUGS.join(', ')}

Rules:
- Return 1-3 slugs maximum
- Return only slugs from the list above
- Return ["other"] if nothing fits
- Return only the JSON array, no explanation, no markdown fences

Event title: ${title}
Event description: ${description ?? 'No description provided'}

Response (JSON array only):`

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { maxOutputTokens: 64, temperature: 0 },
    })

    const text = (response.text ?? '')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim()

    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) return tagByKeyword(title, description)
    const valid = parsed.filter((s): s is CategorySlug => (CATEGORY_SLUGS as string[]).includes(s))
    // If Gemini returns nothing usable, fall back to keywords rather than dropping the event.
    return valid.length > 0 ? valid : tagByKeyword(title, description)
  } catch {
    return tagByKeyword(title, description)
  }
}
