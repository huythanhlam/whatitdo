import { GoogleGenAI } from '@google/genai'
import { CATEGORY_SLUGS, type CategorySlug } from './categories'

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

export async function tagEvent(title: string, description: string | null): Promise<CategorySlug[]> {
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

    const text = (response.text ?? '["other"]')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim()

    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) return ['other']
    return parsed.filter((s): s is CategorySlug => (CATEGORY_SLUGS as string[]).includes(s))
  } catch {
    return ['other']
  }
}
