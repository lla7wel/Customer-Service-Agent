import { redirect } from 'next/navigation';

/** Catalog Review Center entry — opens on the Matches tab. The three review tools
 * (Matches / Image Review / Prices) share a persistent tab bar. */
export default function CatalogReviewPage() {
  redirect('/catalog-match');
}
