/**
 * Server-only re-export barrel for integrations/catalog-match.
 * The 'server-only' guard prevents this scoring code from being bundled into
 * client components. Import from here (not @integrations/catalog-match) within
 * the admin-app so the guard is always applied.
 * Must not: be imported from any 'use client' file.
 */
import 'server-only';

export {
  bestCatalogMatch,
  displayProductName,
  normalizeBarcode,
  normalizeCode,
  prepareMatchProduct,
  scoreMatch,
  scorePreparedMatch,
  summarizeCatalogMatches,
  tokenize,
  type CatalogMatchScore,
  type CatalogMatchSuggestion,
  type MatchCandidate,
  type MatchConfidenceLevel,
  type MatchSummary,
  type MatchableProduct,
  type PreparedMatchProduct,
} from '@integrations/catalog-match';
