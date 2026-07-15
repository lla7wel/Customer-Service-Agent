/**
 * Hand-maintained row types for the tables the app reads/writes.
 * This is intentionally a pragmatic subset (not full generated types) so the
 * UI gets useful typing without a generation step. Keep in sync with
 * database/schema.sql. Generate full types later with:
 *   supabase gen types typescript --project-id <id> > integrations/supabase/database.types.ts
 */

export type ConversationStatus =
  | 'new' | 'ai_handling' | 'needs_human' | 'human_active' | 'waiting_for_customer'
  | 'order_draft' | 'order_confirmed' | 'pickup_requested' | 'delivery_requested'
  | 'resolved' | 'spam' | 'blocked' | 'waiting_for_order_confirmation'
  | 'completed' | 'cancelled' | 'waiting_for_customer_info' | 'issue_refund_exchange';

export type Channel = 'messenger' | 'facebook_comment' | 'instagram' | 'manual';

export type ProductStatus = 'active' | 'draft' | 'archived' | 'out_of_stock';

export type CampaignType =
  | 'single_product_discount' | 'multi_product_carousel' | 'category_sale'
  | 'flash_sale' | 'clearance' | 'seasonal';

export type CampaignStatus =
  | 'draft' | 'scheduled' | 'publishing' | 'published' | 'paused' | 'archived' | 'failed';

export interface Customer {
  id: string;
  channel: Channel;
  external_id: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  is_blocked: boolean;
  tags: string[];
  created_at: string;
}

export interface Conversation {
  id: string;
  customer_id: string | null;
  channel: Channel;
  status: ConversationStatus;
  ai_enabled: boolean;
  detected_intent: string | null;
  context_summary: string | null;
  customer_language: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_human_reply_at: string | null;
  unread_count: number;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  direction: 'inbound' | 'outbound';
  sender_type: 'customer' | 'ai' | 'human' | 'system';
  body: string | null;
  attachments: unknown[];
  ai_meta: Record<string, unknown>;
  is_internal_suggestion: boolean;
  created_at: string;
}

export interface Product {
  id: string;
  product_code: string;
  barcode: string | null;
  source_name: string | null;
  english_name: string | null;
  arabic_name: string | null;
  libyan_display_name: string | null;
  category: string | null;
  subcategory: string | null;
  base_price: number | null;
  campaign_price: number | null;
  active_price: number | null;
  active_campaign_id: string | null;
  website_url: string | null;
  status: ProductStatus;
  availability: string;
  search_keywords: string[];
  arabic_keywords: string[];
  primary_image_id: string | null;
  source: string;
  admin_locked_fields: Record<string, boolean>;
  /** Real semantic embedding (JSON float array) for vector search. */
  text_embedding: number[] | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerMemoryRow {
  id: string;
  customer_id: string;
  summary: string | null;
  recent_products: Array<{ product_id: string; name: string; price: number | null; resolved_at: string; match_type: string }>;
  preferences: Record<string, string>;
  known_facts: string[];
  known_name: string | null;
  known_phone: string | null;
  known_address: string | null;
  last_conversation_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductFingerprint {
  id: string;
  product_id: string;
  hash_hex: string;
  source: string;
  correction_id: string | null;
  created_at: string;
}

export type CatalogMatchState = 'possible' | 'approved' | 'rejected' | 'no_match' | 'needs_review';

export interface CatalogMatchSuggestionRow {
  id: string;
  csv_product_id: string;
  scraper_product_id: string | null;
  score: number | null;
  confidence: 'high' | 'medium' | 'low' | 'none' | null;
  evidence: Record<string, unknown>;
  state: CatalogMatchState;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductImage {
  id: string;
  product_id: string;
  local_path: string | null;
  storage_path: string | null;
  public_url: string | null;
  position: number;
  is_primary: boolean;
}

export interface Campaign {
  id: string;
  name: string;
  type: CampaignType;
  status: CampaignStatus;
  discount_percent: number | null;
  starts_at: string | null;
  ends_at: string | null;
  priority: number;
  caption_tone: string | null;
  generated_caption: string | null;
  objective?: string | null;
  image_text?: string | null;
  aspect_ratio?: string;
  target_channel?: string;
  auto_publish: boolean;
  created_at: string;
}

export type AiBehaviorKey =
  | 'customer_service' | 'reply_language' | 'product_recommendation'
  | 'campaign_caption' | 'campaign_image' | 'image_matching'
  | 'missing_price' | 'memory_context' | 'brand_identity' | 'human_handoff'
  | 'memory_summary' | 'product_preservation' | 'image_typography'
  | 'advanced_task_instructions';

export interface AiBehavior {
  id: string;
  behavior_key: AiBehaviorKey | string;
  title: string;
  prompt: string | null;
  rules: string | null;
  memory: string | null;
  enabled: boolean;
  updated_at: string;
}

export interface ActivityLog {
  id: string;
  actor_type: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  summary: string | null;
  created_at: string;
}

export interface AiEvent {
  id: string;
  kind: string;
  model: string | null;
  detected_intent: string | null;
  latency_ms: number | null;
  success: boolean;
  error: string | null;
  created_at: string;
}
