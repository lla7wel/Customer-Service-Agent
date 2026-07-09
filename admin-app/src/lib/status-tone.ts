type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral';

const CONVERSATION_TONES: Record<string, Tone> = {
  new: 'info',
  ai_handling: 'info',
  needs_human: 'warn',
  human_active: 'good',
  waiting_for_customer: 'neutral',
  order_draft: 'info',
  waiting_for_order_confirmation: 'warn',
  order_confirmed: 'good',
  pickup_requested: 'info',
  delivery_requested: 'info',
  resolved: 'good',
  completed: 'good',
  cancelled: 'neutral',
  spam: 'bad',
  blocked: 'bad',
  waiting_for_customer_info: 'warn',
  issue_refund_exchange: 'bad',
};

const ORDER_TONES: Record<string, Tone> = {
  waiting_for_customer_info: 'warn',
  waiting_for_order_confirmation: 'warn',
  completed: 'good',
  cancelled: 'neutral',
  issue_refund_exchange: 'bad',
};

const CAMPAIGN_TONES: Record<string, Tone> = {
  draft: 'neutral',
  scheduled: 'info',
  publishing: 'info',
  published: 'good',
  paused: 'warn',
  archived: 'neutral',
  failed: 'bad',
};

export function conversationTone(status: string): Tone {
  return CONVERSATION_TONES[status] ?? 'neutral';
}
export function orderTone(status: string): Tone {
  return ORDER_TONES[status] ?? 'neutral';
}
export function campaignTone(status: string): Tone {
  return CAMPAIGN_TONES[status] ?? 'neutral';
}
