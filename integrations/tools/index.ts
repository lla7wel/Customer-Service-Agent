/**
 * Controlled AI tools layer — the database-aware brain's only access to the
 * catalog, customer memory and the correction-learning loop.
 *
 *   products.ts    — find by code/barcode/url, text search, vector search, options
 *   memory.ts      — per-customer persistent AI memory (read/write/context)
 *   corrections.ts — admin correction → fingerprint learning loop
 *   schemas.ts     — Gemini function-calling declarations + executor
 *   vector-search.ts — cosine similarity over JSON embeddings (no pgvector)
 *
 * Read tools may be exposed to Gemini (function calling); write tools are only
 * ever called by the pipeline. Every product tool filters to active+priced and
 * returns catalog-safe names/prices.
 */
export * from './types';
export * from './products';
export * from './memory';
export * from './corrections';
export * from './schemas';
export { cosineSimilarity } from './vector-search';
