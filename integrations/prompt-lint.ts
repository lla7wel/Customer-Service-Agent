export interface PromptLintIssue { code: string; level: 'error'|'warning'; message: string }

export function lintPrompt(task: string, prompt: string): PromptLintIssue[] {
  const issues: PromptLintIssue[] = [];
  const text = prompt.trim();
  if (!text) issues.push({code:'empty',level:'error',message:'The required task prompt is empty.'});
  if (text.length > 24000) issues.push({code:'excessive_length',level:'warning',message:'The prompt is unusually long and may dilute important instructions.'});
  if (/\bcampaign(s)?\b/i.test(text)) issues.push({code:'outdated_campaign_term',level:'warning',message:'Use Content Studio/content instead of the old Campaign terminology.'});
  const lines = text.split(/\n+/).map((x)=>x.trim().toLowerCase()).filter((x)=>x.length>24);
  const seen = new Set<string>();
  if (lines.some((line)=>seen.has(line) ? true : (seen.add(line),false))) issues.push({code:'duplicate_blocks',level:'warning',message:'Repeated instruction lines were detected.'});
  if (['customer_reply','product_recommendation','handoff_reply'].includes(task)) {
    if (!/(العربية|عربي|Libyan Arabic)/i.test(text)) issues.push({code:'missing_arabic_rule',level:'error',message:'Customer-facing tasks must explicitly require Libyan Arabic.'});
    const confirms = /(confirm|collect).{0,25}(order)|تأكيد.{0,15}طلب|جمع.{0,15}بيانات.{0,15}طلب/i.test(text);
    const forbids = /(never|do not|لا).{0,25}(confirm|collect|تؤكد|تجمع)/i.test(text);
    if (confirms && !forbids) issues.push({code:'order_confirmation_conflict',level:'error',message:'The prompt may tell the AI to confirm or collect an order.'});
  }
  return issues;
}
