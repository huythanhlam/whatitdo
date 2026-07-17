// One-off / periodic backfill: generate content embeddings for approved events
// that don't have one yet, so the recommender's semantic feature has data. New
// events can be embedded by re-running this (it's idempotent — only NULL-embedding
// rows are selected). Requires GEMINI_API_KEY; without it embedTexts returns null
// and the script exits having done nothing, which is safe (the scorer treats a
// missing embedding as no signal).
import { getEventsMissingEmbedding, setEventEmbedding } from '@/lib/db'
import { embedTexts, hasGemini } from '@/lib/gemini'
import { embeddingText } from '@/lib/recs/embed'

// Gemini's embedContent accepts a bounded batch; keep well under the limit.
const BATCH_SIZE = 100
// Cap per run so a huge catalog doesn't blow the embedding quota in one go.
const MAX_PER_RUN = 2000

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set — this backfills the shared prod database only.')
    process.exit(1)
  }
  if (!hasGemini()) {
    console.error('GEMINI_API_KEY is not set — cannot generate embeddings.')
    process.exit(1)
  }

  let total = 0
  while (total < MAX_PER_RUN) {
    const batch = await getEventsMissingEmbedding(Math.min(BATCH_SIZE, MAX_PER_RUN - total))
    if (batch.length === 0) break

    const vectors = await embedTexts(batch.map(e => embeddingText(e)))
    if (!vectors) {
      console.error('Embedding call failed (quota or transient) — stopping; re-run later.')
      break
    }
    for (let i = 0; i < batch.length; i++) {
      await setEventEmbedding(batch[i].id, vectors[i])
    }
    total += batch.length
    console.log(`  embedded ${total} event(s)...`)
  }

  console.log(`Done. Embedded ${total} event(s).`)
  process.exit(0)
}

main().catch(err => {
  console.error('Embedding backfill failed:', err)
  process.exit(1)
})
