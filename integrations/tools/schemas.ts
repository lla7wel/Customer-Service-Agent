/**
 * READ-only tool schemas exposed to Gemini function-calling, plus the executor
 * that runs them against the DB. Only safe read tools are exposed — write tools
 * (memory/correction updates) are called by the pipeline, never by the model.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GeminiFunctionDeclaration, ToolExecutor } from '../gemini/client';
import {
  findProductByCode, findProductByBarcode, findProductByUrl,
  searchProductsByText, vectorSearchProductText, getProductPrice, getProductOptions,
} from './products';
import type { ProductCandidate } from './types';

/** Function declarations the model may call during a customer turn. */
export const PRODUCT_TOOL_SCHEMAS: GeminiFunctionDeclaration[] = [
  {
    name: 'findProductByCode',
    description: 'Look up ONE product by its exact product code. Use when the customer gives a product code.',
    parameters: { type: 'object', properties: { code: { type: 'string', description: 'The product code' } }, required: ['code'] },
  },
  {
    name: 'findProductByBarcode',
    description: 'Look up ONE product by its exact barcode (EAN/UPC digits). Use when the customer gives a barcode number.',
    parameters: { type: 'object', properties: { barcode: { type: 'string', description: 'The barcode digits' } }, required: ['barcode'] },
  },
  {
    name: 'findProductByUrl',
    description: 'Look up ONE product by an English Home product link the customer pasted.',
    parameters: { type: 'object', properties: { url: { type: 'string', description: 'The product URL' } }, required: ['url'] },
  },
  {
    name: 'searchProductsByText',
    description: 'Search the catalog by keywords (Arabic/English) when the customer describes a product in words. Returns up to a few priced products.',
    parameters: {
      type: 'object',
      properties: { terms: { type: 'array', description: 'Search keywords', items: { type: 'string' } } },
      required: ['terms'],
    },
  },
  {
    name: 'vectorSearchProductText',
    description: 'Semantic catalog search for a free-text product description (handles synonyms / loose wording). Use when keyword search may miss.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Natural-language product description' } }, required: ['query'] },
  },
  {
    name: 'getProductPrice',
    description: 'Get the current price of a known product id.',
    parameters: { type: 'object', properties: { productId: { type: 'string' } }, required: ['productId'] },
  },
  {
    name: 'getProductOptions',
    description: 'Get other options in the same product family/category for a product id (e.g. other colors/sizes if they exist as separate products).',
    parameters: { type: 'object', properties: { productId: { type: 'string' } }, required: ['productId'] },
  },
];

/** Trim a candidate to the fields worth giving back to the model (keeps tokens low). */
function slim(c: ProductCandidate) {
  return { id: c.id, name: c.name, price: c.price, product_code: c.product_code, website_url: c.website_url };
}

/** Build the executor that runs the READ tools against the DB for this turn. */
export function buildProductToolExecutor(db: SupabaseClient): ToolExecutor {
  return async (name, args) => {
    switch (name) {
      case 'findProductByCode': {
        const r = await findProductByCode(db, String(args.code ?? ''));
        return r.ok ? (r.data ? slim(r.data) : { found: false }) : { error: r.reason };
      }
      case 'findProductByBarcode': {
        const r = await findProductByBarcode(db, String(args.barcode ?? ''));
        return r.ok ? (r.data ? slim(r.data) : { found: false }) : { error: r.reason };
      }
      case 'findProductByUrl': {
        const r = await findProductByUrl(db, String(args.url ?? ''));
        return r.ok ? (r.data ? slim(r.data) : { found: false }) : { error: r.reason };
      }
      case 'searchProductsByText': {
        const terms = Array.isArray(args.terms) ? (args.terms as unknown[]).map(String) : [];
        const r = await searchProductsByText(db, terms, 8);
        return r.ok ? r.data.map(slim) : { error: r.reason };
      }
      case 'vectorSearchProductText': {
        const r = await vectorSearchProductText(db, String(args.query ?? ''), 8);
        return r.ok ? r.data.map(slim) : { error: r.reason };
      }
      case 'getProductPrice': {
        const r = await getProductPrice(db, String(args.productId ?? ''));
        return r.ok ? r.data : { error: r.reason };
      }
      case 'getProductOptions': {
        const r = await getProductOptions(db, String(args.productId ?? ''), 5);
        return r.ok ? r.data.map(slim) : { error: r.reason };
      }
      default:
        return { error: `unknown_tool:${name}` };
    }
  };
}
