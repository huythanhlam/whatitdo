import Anthropic from '@anthropic-ai/sdk'
import { CATEGORY_SLUGS, type CategorySlug } from './categories'

const client = new Anthropic()

export async function tagEvent(title: string, description: string | null): Promise<CategorySlug[]> {
  const prompt = `You are categorizing Austin, TX events. Given an event title and description, return a JSON array of category slugs that apply.

Available slugs: ${CATEGORY_SLUGS.join(', ')}

Rules:
- Return 1-3 slugs maximum
- Return only slugs from the list above
- Return ["other"] if nothing fits
- Return only the JSON array, no explanation

Event title: ${title}
Event description: ${description ?? 'No description provided'}

Response (JSON array only):`

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 64,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '["other"]'
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) return ['other']
    return parsed.filter((s): s is CategorySlug => (CATEGORY_SLUGS as string[]).includes(s))
  } catch {
    return ['other']
  }
}
