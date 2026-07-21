/**
 * Tool schemas exposed to Gemini function-calling, plus the executor that runs
 * them against the DB.
 *
 * READ tools return verified catalog data. ACTION tools never act directly:
 * they record a REQUEST into the turn's action collector and the server
 * decides whether the action is permitted (image cap of three, single order
 * handoff, human-attention flag). The model has no write path, no network,
 * no credentials, and cannot send anything itself.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import type { GeminiFunctionDeclaration, ToolExecutor } from '../gemini/client';
import {
  findProductByCode, findProductByBarcode, findProductByUrl,
  searchProductsByText, vectorSearchProductText, getProductPrice, getProductOptions,
} from './products';
import { searchFamilies, getFamilyProducts, getRelatedProducts } from './families';
import type { ProductCandidate } from './types';

/** Server-side collector for model-requested actions (validated later). */
export interface TurnActionRequests {
  /** Product ids the model asked to send photos of (server caps at 3, validates). */
  imageProductIds: string[];
  /** The model believes a human must follow up. */
  humanAttention: { requested: boolean; reason: string | null };
  /** The model believes the customer wants to ORDER (server sends the single handoff). */
  orderHandoff: { requested: boolean };
}

export function newActionRequests(): TurnActionRequests {
  return { imageProductIds: [], humanAttention: { requested: false, reason: null }, orderHandoff: { requested: false } };
}

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
    name: 'searchFamilies',
    description: 'For BROAD requests (e.g. "what bedding do you have?"), get compact product-family summaries: name, variant count, verified price range. Use this to summarize options instead of listing many products.',
    parameters: {
      type: 'object',
      properties: { terms: { type: 'array', description: 'Search keywords', items: { type: 'string' } } },
      required: ['terms'],
    },
  },
  {
    name: 'getFamilyProducts',
    description: 'List the sellable variants (sizes/colors/set options) of one product family id from searchFamilies.',
    parameters: { type: 'object', properties: { familyId: { type: 'string' } }, required: ['familyId'] },
  },
  {
    name: 'getRelatedProducts',
    description: 'Get genuinely related products for a product id: its other variants, set members, and complementary items. Never returns unrelated products.',
    parameters: { type: 'object', properties: { productId: { type: 'string' } }, required: ['productId'] },
  },
  {
    name: 'vectorSearchProductText',
    description: 'Semantic catalog search for a free-text product description (handles synonyms / loose wording). Use when keyword search may miss.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Natural-language product description' } }, required: ['query'] },
  },
  {
    name: 'getProductPrice',
    description: 'Get the current verified price of a known product id. This is the ONLY price you may state.',
    parameters: { type: 'object', properties: { productId: { type: 'string' } }, required: ['productId'] },
  },
  {
    name: 'getProductOptions',
    description: 'Get other options in the same product family/category for a product id (e.g. other colors/sizes if they exist as separate products).',
    parameters: { type: 'object', properties: { productId: { type: 'string' } }, required: ['productId'] },
  },
  {
    name: 'requestProductImages',
    description: 'Ask the system to send the customer real catalog photos of up to three product ids. The system validates and sends them — never claim a photo was sent yourself.',
    parameters: {
      type: 'object',
      properties: { productIds: { type: 'array', description: 'Catalog product ids (max 3)', items: { type: 'string' } } },
      required: ['productIds'],
    },
  },
  {
    name: 'markHumanAttention',
    description: 'Flag this conversation for the human team (complaint, refund, payment issue, missing information you cannot verify). You can and should still answer what you CAN verify.',
    parameters: { type: 'object', properties: { reason: { type: 'string', description: 'Short reason' } }, required: ['reason'] },
  },
  {
    name: 'requestOrderHandoff',
    description: 'The customer clearly wants to ORDER/buy/reserve/pay. The system sends the one official order-handoff message with the WhatsApp contacts. Never collect order details or confirm an order yourself.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
];

/** Trim a candidate to the fields worth giving back to the model (keeps tokens low). */
function slim(c: ProductCandidate) {
  return { id: c.id, name: c.name, price: c.price, product_code: c.product_code, website_url: c.website_url };
}

/** Build the executor that runs the tools against the DB for this turn. */
export function buildProductToolExecutor(db: Kysely<DB>, actions?: TurnActionRequests): ToolExecutor {
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
      case 'searchFamilies': {
        const terms = Array.isArray(args.terms) ? (args.terms as unknown[]).map(String) : [];
        const r = await searchFamilies(db, terms, 6);
        return r.ok ? r.data : { error: r.reason };
      }
      case 'getFamilyProducts': {
        const r = await getFamilyProducts(db, String(args.familyId ?? ''), 10);
        return r.ok ? r.data.map(slim) : { error: r.reason };
      }
      case 'getRelatedProducts': {
        const r = await getRelatedProducts(db, String(args.productId ?? ''), 8);
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
      case 'requestProductImages': {
        const ids = Array.isArray(args.productIds) ? (args.productIds as unknown[]).map(String).slice(0, 3) : [];
        if (actions) {
          for (const id of ids) {
            if (!actions.imageProductIds.includes(id) && actions.imageProductIds.length < 3) {
              actions.imageProductIds.push(id);
            }
          }
        }
        return { requested: ids.length, note: 'The system will validate and send real catalog photos. Do not claim they were sent.' };
      }
      case 'markHumanAttention': {
        if (actions) {
          actions.humanAttention.requested = true;
          actions.humanAttention.reason = String(args.reason ?? '').slice(0, 200) || null;
        }
        return { flagged: true };
      }
      case 'requestOrderHandoff': {
        if (actions) actions.orderHandoff.requested = true;
        return { note: 'The system sends the official order-handoff message. Keep your reply short and warm; do not repeat contact details.' };
      }
      default:
        return { error: `unknown_tool:${name}` };
    }
  };
}
