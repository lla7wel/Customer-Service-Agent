/**
 * Cosine similarity over JSON-stored embedding vectors. No pgvector required —
 * embeddings are stored as JSON float arrays in products.text_embedding and
 * compared here (bounded scan, consistent with the existing dHash scan). This
 * keeps the vector layer portable across any Postgres/Supabase project.
 */

/** Cosine similarity of two equal-length vectors → 0..1 (0 if invalid). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  const sim = dot / (Math.sqrt(na) * Math.sqrt(nb));
  if (!Number.isFinite(sim)) return 0;
  return Math.max(0, Math.min(1, sim));
}
