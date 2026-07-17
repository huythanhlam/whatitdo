// Recommendation engine — embedding helpers (pure; no DB, no network).
//
// The semantic feature compares an event's content embedding to the actor's
// taste vector via cosine similarity. Generation lives in lib/gemini.ts
// (embedTexts) and the backfill script; this module holds the math the scorer
// and the write-through vector update need.

// The text an event is embedded from — title carries most of the signal, with a
// slice of description for context. Kept here so the backfill and any future
// re-embed use exactly the same input.
export function embeddingText(ev: { title: string; description: string | null }): string {
  return `${ev.title}\n${(ev.description ?? '').slice(0, 500)}`.trim()
}

// Cosine similarity in [-1, 1]; 0 when either vector is missing, empty, or
// mismatched in length (treated as "no signal"). Guards the zero-norm case.
export function cosine(a: number[] | null | undefined, b: number[] | null | undefined): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

// Blend a newly-engaged event's embedding into an actor's taste vector as a
// running mean over `n` prior observations: vec' = (vec*n + e) / (n+1). Returns
// the new vector and count. With no prior vector it's just the event embedding.
export function blendVector(
  prev: { vec: number[]; n: number } | null,
  embedding: number[],
): { vec: number[]; n: number } {
  if (!prev || prev.vec.length !== embedding.length) {
    return { vec: [...embedding], n: 1 }
  }
  const n = prev.n
  const vec = prev.vec.map((v, i) => (v * n + embedding[i]) / (n + 1))
  return { vec, n: n + 1 }
}
