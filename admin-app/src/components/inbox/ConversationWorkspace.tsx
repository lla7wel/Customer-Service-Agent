'use client';
/* eslint-disable @next/next/no-img-element -- Messenger attachments are arbitrary public media URLs */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Send, Sparkles, Search, Package, Bot, User, X, Plus, ScanSearch, ImageOff, CircleSlash, Check, ChevronDown, ChevronUp, AlertTriangle, Image as ImageIcon } from 'lucide-react';
import type { Locale } from '@/lib/i18n/config';

interface Attachment { type?: string; url?: string }
interface Msg {
  id: string;
  direction: 'inbound' | 'outbound';
  sender_type: 'customer' | 'ai' | 'human' | 'system';
  body: string | null;
  is_internal_suggestion: boolean;
  created_at: string;
  delivered_at?: string | null;
  delivery_status?: string | null;
  attachments?: Attachment[];
  ai_meta?: Record<string, unknown>;
}
interface FailedOutbox { id: string; message_id: string | null; kind: string; status: string; last_error: string | null }
interface FoundProduct { id: string; code: string; name: string; original_name?: string | null; price: number | null; image: string | null; website_url?: string | null }
interface Candidate {
  id: string; product_code: string | null; name: string; price: number | null;
  image: string | null; website_url?: string | null; original_name?: string | null; confidence?: number; reason?: string | null;
}

function deriveCandidates(messages: Msg[]): Candidate[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const c = (messages[i].ai_meta as any)?.candidates;
    if (Array.isArray(c) && c.length) return c as Candidate[];
  }
  return [];
}

export default function ConversationWorkspace({
  conversationId,
  aiEnabled: aiEnabledInitial,
  initialMessages,
  candidates: candidatesInitial = [],
  locale,
}: {
  conversationId: string;
  aiEnabled: boolean;
  initialMessages: Msg[];
  candidates?: Candidate[];
  locale: Locale;
}) {
  const ar = locale === 'ar';
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [candidates, setCandidates] = useState<Candidate[]>(candidatesInitial);
  const [aiEnabled, setAiEnabled] = useState(aiEnabledInitial);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'send' | 'suggest' | 'candidates' | null>(null);
  const [notice, setNotice] = useState<{ k: 'ok' | 'info' | 'err'; t: string } | null>(null);
  const [showProducts, setShowProducts] = useState(false);
  const [imgBusy, setImgBusy] = useState(false);
  const [imgCandidates, setImgCandidates] = useState<Candidate[] | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [channel, setChannel] = useState<string>('messenger');
  const [attention, setAttention] = useState<{ flag: boolean; reason: string | null }>({ flag: false, reason: null });
  const [failedOutbox, setFailedOutbox] = useState<FailedOutbox[]>([]);
  const threadRef = useRef<HTMLDivElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);

  // Live polling — updates local state only (no router.refresh, which caused the
  // whole page to re-render and flicker every few seconds). An AbortController
  // cancels any in-flight request when the conversation unmounts.
  const poll = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/inbox/${conversationId}`, { cache: 'no-store', signal });
      if (!res.ok) return;
      const d = await res.json();
      const msgs: Msg[] = (d.messages ?? []).map((m: any) => ({
        id: m.id, direction: m.direction, sender_type: m.sender_type, body: m.body,
        is_internal_suggestion: m.is_internal_suggestion, created_at: m.created_at,
        delivered_at: m.delivered_at ?? null,
        delivery_status: m.delivery_status ?? null,
        attachments: m.attachments ?? [], ai_meta: m.ai_meta ?? {},
      }));
      setMessages(msgs);
      setCandidates(deriveCandidates(msgs));
      if (typeof d.ai_enabled === 'boolean') setAiEnabled(d.ai_enabled);
      if (typeof d.channel === 'string') setChannel(d.channel);
      setAttention({ flag: !!d.human_attention, reason: d.human_attention_reason ?? null });
      setFailedOutbox(d.failed_outbox ?? []);
    } catch { /* ignore transient/aborted poll errors */ }
  }, [conversationId]);

  useEffect(() => {
    const controller = new AbortController();
    const t = setInterval(() => poll(controller.signal), 5000);
    return () => { clearInterval(t); controller.abort(); };
  }, [poll]);

  // Auto-scroll to newest.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  async function action(action: string, body: Record<string, unknown> = {}) {
    const res = await fetch(`/api/inbox/${conversationId}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...body }),
    });
    return { res, data: await res.json().catch(() => ({})) };
  }

  const candidateLine = (c: Candidate, index?: number) => {
    const prefix = index != null ? `${index}. ` : '';
    const line = `${prefix}${c.name}${c.price != null ? ` — ${c.price} د.ل` : ' — السعر بنأكدولك عليه'}`;
    return c.website_url ? `${line}\n${c.website_url}` : line;
  };

  async function send() {
    if (!text.trim()) return;
    setBusy('send'); setNotice(null);
    const { res, data } = await action('send_human_message', { text });
    setBusy(null);
    if (res.ok) {
      setText('');
      setNotice({ k: 'ok', t: data.queued ? (ar ? 'في طابور الإرسال — تظهر الحالة على الرسالة' : 'Queued — status shows on the message') : (ar ? 'حُفظ' : 'Saved') });
      poll();
    } else if (res.status === 503) {
      setNotice({ k: 'info', t: (ar ? 'الإرسال موقوف: ' : 'Sending disabled: ') + (data?.missing?.join(', ') || data?.error) });
    } else setNotice({ k: 'err', t: data?.error || 'Failed' });
  }

  async function suggest() {
    setBusy('suggest'); setNotice(null);
    const { res, data } = await action('suggest_reply');
    setBusy(null);
    if (res.ok && data?.text) {
      setText(data.text);
      setNotice({ k: 'ok', t: ar ? 'اقتراح جاهز — عدّله قبل الإرسال' : 'Draft ready — edit before sending' });
    } else if (res.status === 503) {
      setNotice({ k: 'info', t: (ar ? 'الذكاء غير مربوط: ' : 'AI not connected: ') + (data?.missing?.join(', ') || 'GEMINI_API_KEY') });
    } else setNotice({ k: 'err', t: data?.error || 'Failed' });
  }

  async function sendText(t: string, label: string) {
    if (!t.trim()) return;
    setBusy('candidates'); setNotice(null);
    const { res, data } = await action('send_human_message', { text: t });
    setBusy(null);
    if (res.ok) {
      setNotice({ k: 'ok', t: ar ? `${label} — في طابور الإرسال` : `${label} — queued` });
      poll();
    } else if (res.status === 503) {
      setNotice({ k: 'info', t: (ar ? 'الإرسال موقوف: ' : 'Sending disabled: ') + (data?.missing?.join(', ') || data?.error || 'Meta not configured') });
    } else setNotice({ k: 'err', t: data?.error || 'Failed' });
  }

  function sendAllCandidates() {
    // Customer-facing text is ALWAYS Libyan Arabic, regardless of the admin's UI
    // language. The button label (last arg) follows the admin locale; the message
    // sent to the customer does not.
    const intro = 'لقيتلك أقرب خيارات، تقصدي أي واحد فيهم؟';
    sendText(`${intro}\n${candidates.slice(0, 5).map((c, i) => candidateLine(c, i + 1)).join('\n')}`, ar ? 'الخيارات' : 'Options');
  }

  async function markNoMatch() {
    setBusy('candidates');
    const { res } = await action('mark_resolved');
    setBusy(null);
    if (res.ok) { setNotice({ k: 'ok', t: ar ? 'تم وضع علامة لا تطابق' : 'Marked no-match' }); poll(); }
  }

  // Persist an attachment into AI context (customer_memory.recent_products) so
  // follow-ups like "بكم؟"/"نفس اللي قبل" use it. Optionally drops a line into
  // the composer too.
  async function attachProduct(p: FoundProduct, insertLine = true) {
    setShowProducts(false);
    if (insertLine) {
      const line = `${p.name}${p.price != null ? ` — ${p.price} د.ل` : ''}${p.website_url ? `\n${p.website_url}` : ''}`;
      setText((t) => (t ? `${t}\n${line}` : line));
    }
    const { res } = await action('attach_product', { productId: p.id });
    if (res.ok) { setNotice({ k: 'ok', t: ar ? `تم إرفاق ${p.name} لسياق الذكاء` : `Attached ${p.name} to AI context` }); }
    else setNotice({ k: 'err', t: ar ? 'فشل الإرفاق' : 'Attach failed' });
  }

  // Upload an image and find matching catalog products via the SAME image
  // pipeline the customer side uses (canonical resolver, admin mode).
  async function runImageSearch(file: File) {
    setImgBusy(true); setNotice(null); setImgCandidates(null);
    try {
      const b64: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const { res, data } = await action('image_search', { image: { data: b64, mime: file.type } });
      if (res.status === 503) { setNotice({ k: 'info', t: (ar ? 'الذكاء غير مربوط: ' : 'AI not connected: ') + (data?.missing?.join(', ') || 'GEMINI_API_KEY') }); return; }
      if (!res.ok) { setNotice({ k: 'err', t: (data?.timeout ? (ar ? 'انتهت المهلة — جرّب صورة أوضح' : 'Timed out — try a clearer image') : (data?.error || (ar ? 'فشل البحث' : 'Search failed'))) }); return; }
      const cands = (data.candidates ?? []) as Candidate[];
      setImgCandidates(cands);
      setNotice({ k: cands.length ? 'ok' : 'info', t: cands.length ? (ar ? `تم العثور على ${cands.length} منتج` : `Found ${cands.length} product(s)`) : (ar ? 'لا يوجد تطابق واضح' : 'No clear match') });
      poll(); // timeline gained the uploaded image
    } catch { setNotice({ k: 'err', t: ar ? 'تعذّر قراءة الصورة' : 'Could not read image' }); }
    finally { setImgBusy(false); }
  }

  // Newest customer message that carried an image (so a correction learns from it).
  function lastImageMessageId(): string | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.direction !== 'inbound') continue;
      if ((m.attachments ?? []).some((a) => a?.type === 'image' && a?.url)) return m.id;
    }
    return null;
  }

  // Manually send a product's catalog photo to the customer (uses the same Meta
  // image helper as the AI). Disabled when the product has no usable image.
  async function sendProductImage(c: Candidate) {
    if (!c.image) { setNotice({ k: 'info', t: ar ? 'لا توجد صورة لهذا المنتج' : 'No image for this product' }); return; }
    setBusy('candidates'); setNotice(null);
    const { res, data } = await action('send_product_image', { productId: c.id });
    setBusy(null);
    if (res.ok) {
      setNotice({ k: 'ok', t: ar ? 'الصورة في طابور الإرسال' : 'Image queued for delivery' });
      poll();
    } else if (res.status === 503) {
      setNotice({ k: 'info', t: (ar ? 'الإرسال موقوف: ' : 'Sending disabled: ') + (data?.missing?.join(', ') || data?.error || 'Meta not configured') });
    } else setNotice({ k: 'err', t: data?.error === 'no_image' ? (ar ? 'لا توجد صورة صالحة' : 'No usable image') : (data?.error || 'Failed') });
  }

  // One-click admin correction: link the customer image to the right product so
  // future image matching learns from it.
  async function correctMatch(c: Candidate) {
    setBusy('candidates'); setNotice(null);
    const { res, data } = await action('correct_image_match', { productId: c.id, messageId: lastImageMessageId() });
    setBusy(null);
    if (res.ok) setNotice({ k: 'ok', t: ar ? (data.learned ? 'تم الربط — حيتعلم منها' : 'تم الربط') : (data.learned ? 'Linked — will learn from it' : 'Linked') });
    else setNotice({ k: 'err', t: data?.error || 'Failed' });
  }

  return (
    <div className="card flex h-[calc(100vh-170px)] min-h-[540px] flex-col overflow-hidden p-0 shadow-glass md:h-[calc(100vh-150px)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface/85 px-3 py-2.5 backdrop-blur-md sm:px-4">
        <div className="flex items-center gap-2">
          <span className={`status-dot ${aiEnabled ? 'bg-success' : 'bg-warning'}`} />
          <div>
            <p className="text-xs font-semibold text-fg">{ar ? 'مساحة المحادثة' : 'Conversation workspace'}</p>
            <p className="text-[11px] text-faint">
              {messages.length.toLocaleString()} {ar ? 'رسالة' : 'messages'} · {candidates.length.toLocaleString()} {ar ? 'مطابقة' : 'matches'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`chip ${channel === 'instagram' ? 'bg-fuchsia-500/12 text-fuchsia-400 ring-fuchsia-500/25' : 'bg-sky-500/12 text-sky-400 ring-sky-500/25'}`}>
            {channel === 'instagram' ? (ar ? 'إنستغرام' : 'Instagram') : (ar ? 'ماسنجر' : 'Messenger')}
          </span>
          {attention.flag && (
            <button
              onClick={async () => { await action('clear_attention'); poll(); }}
              className="chip bg-warning/12 text-warning ring-warning/25"
              title={ar ? 'اضغط لإزالة العلامة بعد المتابعة' : 'Click to clear after following up'}
            >
              <AlertTriangle size={12} /> {ar ? 'يحتاج الفريق' : 'Needs team'}{attention.reason ? ` · ${attention.reason}` : ''} ✕
            </button>
          )}
          <span className={`chip ${aiEnabled ? 'bg-success/12 text-success ring-success/25' : 'bg-warning/12 text-warning ring-warning/25'}`}>
            <Bot size={12} /> {aiEnabled ? (ar ? 'AI مفعّل' : 'AI enabled') : (ar ? 'AI متوقف' : 'AI paused')}
          </span>
        </div>
      </div>

      {/* failed / uncertain deliveries — truthful, with explicit manual retry */}
      {failedOutbox.length > 0 && (
        <div className="border-b border-danger/30 bg-danger/5 px-3 py-2">
          {failedOutbox.map((o) => (
            <div key={o.id} className="flex flex-wrap items-center gap-2 py-0.5 text-xs">
              <AlertTriangle size={12} className="text-danger" />
              <span className="text-danger">
                {o.status === 'uncertain'
                  ? (ar ? 'إرسال غير مؤكد (قد يكون وصل)' : 'Uncertain delivery (may have arrived)')
                  : (ar ? 'فشل الإرسال' : 'Delivery failed')}
                {o.kind === 'image' ? (ar ? ' · صورة' : ' · image') : ''}
              </span>
              <span className="min-w-0 flex-1 truncate text-faint">{o.last_error ?? ''}</span>
              <button
                onClick={async () => { await action('retry_outbox', { outboxId: o.id }); poll(); }}
                className="btn-ghost h-7 px-2 text-[11px]"
              >
                {ar ? 'إعادة الإرسال' : 'Retry'}
              </button>
            </div>
          ))}
        </div>
      )}
      {/* thread */}
      <div ref={threadRef} className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto bg-bg/25 p-3 sm:p-4">
        {messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-faint">{ar ? 'لا توجد رسائل بعد' : 'No messages yet'}</p>
        ) : (
          messages.map((m) => <Bubble key={m.id} m={m} ar={ar} />)
        )}
      </div>

      {/* image-match candidate options (collapsible so it never blocks the thread) */}
      {candidates.length > 0 && (
        <div className="border-t border-line bg-elevated/75 p-3 backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between gap-2">
            <button onClick={() => setPanelOpen((v) => !v)} className="flex items-center gap-1.5 text-xs font-semibold text-fg" title={ar ? 'طي/فتح' : 'Collapse/expand'}>
              {panelOpen ? <ChevronDown size={14} className="text-faint" /> : <ChevronUp size={14} className="text-faint" />}
              <ScanSearch size={14} className="text-accent" />
              {ar ? `خيارات مطابقة (${candidates.length})` : `Match options (${candidates.length})`}
            </button>
            <div className="flex gap-1.5">
              <button onClick={sendAllCandidates} disabled={busy !== null} className="btn-primary h-8 px-2.5 text-xs">
                <Send size={13} className="rtl-flip" /> {ar ? 'إرسال الخيارات' : 'Send options'}
              </button>
              <button onClick={markNoMatch} disabled={busy !== null} className="btn-ghost h-8 px-2.5 text-xs" title={ar ? 'لا تطابق' : 'No match'}>
                <CircleSlash size={13} /> {ar ? 'لا تطابق' : 'No match'}
              </button>
            </div>
          </div>
          <div className={`scroll-thin grid gap-2 overflow-y-auto 2xl:grid-cols-2 ${panelOpen ? 'max-h-72' : 'max-h-0'}`}>
            {candidates.map((c) => (
              <div key={c.id} className="tilt-card flex min-w-0 items-start gap-3 rounded-lg border border-line bg-surface p-2.5 transition hover:border-accent/40">
                <Thumb url={c.image} />
                <div className="min-w-0 flex-1">
                  <a href={`/catalog/${c.id}`} className="block wrap-break-word text-sm font-semibold leading-snug text-fg hover:text-accent" dir="auto">{c.name}</a>
                  {c.original_name && <p className="mt-0.5 truncate text-[11px] text-muted" title={c.original_name}>{c.original_name}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-faint">
                    {c.product_code && <span className="font-mono">{c.product_code}</span>}
                    <span className="ltr-nums text-success">{c.price != null ? `${c.price} د.ل` : (ar ? 'بدون سعر' : 'no price')}</span>
                    {typeof c.confidence === 'number' && <span className="rounded-sm bg-surface2 px-1.5 py-0.5">{Math.round(c.confidence * 100)}%</span>}
                  </div>
                  {c.reason && <p className="mt-1 line-clamp-2 text-[10px] text-faint" title={c.reason}>{c.reason}</p>}
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <button onClick={() => sendText(candidateLine(c), c.name)} disabled={busy !== null} className="btn-subtle h-7 px-2 text-[11px]" title={ar ? 'إرسال هذا' : 'Send this'}>
                    <Send size={12} className="rtl-flip" />
                  </button>
                  <button onClick={() => sendProductImage(c)} disabled={busy !== null || !c.image} className="btn-ghost h-7 px-2 text-[11px] text-accent disabled:opacity-40" title={c.image ? (ar ? 'إرسال الصورة للعميل' : 'Send photo to customer') : (ar ? 'لا توجد صورة' : 'No image')}>
                    <ImageIcon size={12} />
                  </button>
                  <button onClick={() => correctMatch(c)} disabled={busy !== null} className="btn-ghost h-7 px-2 text-[11px] text-success" title={ar ? 'هذا هو المنتج الصحيح (تعلّم)' : 'Correct product (learn)'}>
                    <Check size={12} />
                  </button>
                  <button onClick={() => attachProduct({ id: c.id, code: c.product_code ?? '', name: c.name, original_name: c.original_name, price: c.price, image: c.image, website_url: c.website_url })} className="btn-ghost h-7 px-2 text-[11px]" title={ar ? 'إرفاق' : 'Attach'}>
                    <Plus size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* image-search results (admin uploaded an image to find products) */}
      {imgCandidates !== null && (
        <div className="border-t border-line bg-elevated/75 p-3 backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-fg">
              <ScanSearch size={14} className="text-accent" />
              {ar ? `نتائج البحث بالصورة (${imgCandidates.length})` : `Image search results (${imgCandidates.length})`}
            </span>
            <button onClick={() => setImgCandidates(null)} className="btn-ghost h-7 px-2 text-[11px]"><X size={12} /></button>
          </div>
          {imgCandidates.length === 0 ? (
            <p className="py-3 text-center text-xs text-faint">{ar ? 'لا يوجد تطابق واضح — جرّب صورة أوضح أو الكود.' : 'No clear match — try a clearer image or the code.'}</p>
          ) : (
            <div className="scroll-thin grid max-h-72 gap-2 overflow-y-auto 2xl:grid-cols-2">
              {imgCandidates.map((c) => (
                <div key={c.id} className="tilt-card flex min-w-0 items-start gap-3 rounded-lg border border-line bg-surface p-2.5 transition hover:border-accent/40">
                  <Thumb url={c.image} />
                  <div className="min-w-0 flex-1">
                    <a href={`/catalog/${c.id}`} className="block wrap-break-word text-sm font-semibold leading-snug text-fg hover:text-accent" dir="auto">{c.name}</a>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-faint">
                      {c.product_code && <span className="font-mono">{c.product_code}</span>}
                      <span className="ltr-nums text-success">{c.price != null ? `${c.price} د.ل` : (ar ? 'بدون سعر' : 'no price')}</span>
                      {typeof c.confidence === 'number' && <span className="rounded-sm bg-surface2 px-1.5 py-0.5">{Math.round(c.confidence * 100)}%</span>}
                    </div>
                    {c.reason && <p className="mt-1 line-clamp-2 text-[10px] text-faint" title={c.reason}>{c.reason}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button onClick={() => sendText(candidateLine(c), c.name)} disabled={busy !== null} className="btn-subtle h-7 px-2 text-[11px]" title={ar ? 'إرسال هذا' : 'Send this'}>
                      <Send size={12} className="rtl-flip" />
                    </button>
                    <button onClick={() => sendProductImage(c)} disabled={busy !== null || !c.image} className="btn-ghost h-7 px-2 text-[11px] text-accent disabled:opacity-40" title={c.image ? (ar ? 'إرسال الصورة للعميل' : 'Send photo to customer') : (ar ? 'لا توجد صورة' : 'No image')}>
                      <ImageIcon size={12} />
                    </button>
                    <button onClick={() => attachProduct({ id: c.id, code: c.product_code ?? '', name: c.name, original_name: c.original_name, price: c.price, image: c.image, website_url: c.website_url }, false)} className="btn-ghost h-7 px-2 text-[11px] text-accent" title={ar ? 'إرفاق لسياق الذكاء' : 'Attach to AI context'}>
                      <Plus size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showProducts && <ProductSearch ar={ar} onPick={attachProduct} onClose={() => setShowProducts(false)} />}

      {/* composer */}
      <div className="border-t border-line bg-surface/90 p-3 backdrop-blur-md">
        {notice && (
          <p className={`mb-2 text-xs ${notice.k === 'ok' ? 'text-success' : notice.k === 'info' ? 'text-info' : 'text-danger'}`}>{notice.t}</p>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          dir="auto"
          placeholder={ar ? 'اكتب ردّك للعميل…' : 'Type your reply to the customer…'}
          className="input resize-none"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button onClick={send} disabled={busy !== null || !text.trim()} className="btn-primary">
            <Send size={15} className="rtl-flip" /> {busy === 'send' ? '…' : ar ? 'إرسال' : 'Send'}
          </button>
          <button onClick={suggest} disabled={busy !== null} className="btn-ghost">
            <Sparkles size={15} className="text-accent" /> {busy === 'suggest' ? '…' : ar ? 'اقتراح الذكاء' : 'AI suggest'}
          </button>
          <button onClick={() => setShowProducts((v) => !v)} className="btn-ghost">
            <Package size={15} /> {ar ? 'إرفاق منتج' : 'Attach product'}
          </button>
          <button onClick={() => imgInputRef.current?.click()} disabled={imgBusy} className="btn-ghost" title={ar ? 'ارفع صورة لإيجاد منتج' : 'Upload image to find products'}>
            <ScanSearch size={15} className="text-accent" /> {imgBusy ? (ar ? 'جاري البحث…' : 'Searching…') : (ar ? 'بحث بالصورة' : 'Image search')}
          </button>
          <input
            ref={imgInputRef} type="file" accept="image/*" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) runImageSearch(f); e.currentTarget.value = ''; }}
          />
          {!aiEnabled && <span className="ms-auto text-xs text-warning">{ar ? 'الذكاء متوقف' : 'AI paused'}</span>}
        </div>
      </div>
    </div>
  );
}

function Thumb({ url }: { url: string | null }) {
  const [ok, setOk] = useState(!!url);
  return (
    <span className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-line bg-surface2">
      {url && ok ? (
        <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" onError={() => setOk(false)} />
      ) : (
        <span className="flex h-full flex-col items-center justify-center gap-1 text-faint"><ImageOff size={16} /><span className="text-[9px]">No image</span></span>
      )}
    </span>
  );
}

function Bubble({ m, ar }: { m: Msg; ar: boolean }) {
  const customer = m.direction === 'inbound';
  const who = m.sender_type === 'customer' ? (ar ? 'العميل' : 'Customer') : m.sender_type === 'ai' ? 'AI' : m.sender_type === 'human' ? (ar ? 'موظف' : 'Agent') : 'System';
  const Icon = m.sender_type === 'ai' ? Bot : m.sender_type === 'human' ? User : null;
  const images = (m.attachments ?? []).filter((a) => a?.type === 'image' && a?.url);
  // Truthful delivery status for outbound messages (outbox-driven).
  const deliveryError = (m.ai_meta as any)?.delivery_error as string | undefined;
  const outboundReal = !customer && !m.is_internal_suggestion && (m.sender_type === 'human' || m.sender_type === 'ai');
  const ds = m.delivery_status ?? (m.delivered_at ? 'sent' : (deliveryError ? 'failed' : null));
  return (
    <div className={`flex w-full min-w-0 flex-col ${customer ? 'items-start' : 'items-end'}`}>
      <span className="mb-1 flex items-center gap-1 text-[10px] text-faint">
        {Icon && <Icon size={11} />}
        {who}{m.is_internal_suggestion ? (ar ? ' · اقتراح داخلي' : ' · internal') : ''}
        {outboundReal && ds === 'sent' && <span className="flex items-center gap-0.5 text-success"><Check size={11} /> {ar ? 'أُرسل' : 'sent'}</span>}
        {outboundReal && ds === 'partial' && <span className="flex items-center gap-0.5 text-warning"><AlertTriangle size={11} /> {ar ? 'أُرسل جزئياً' : 'partial'}</span>}
        {outboundReal && ds === 'pending' && <span className="text-faint">{ar ? 'قيد الإرسال…' : 'sending…'}</span>}
        {outboundReal && ds === 'uncertain' && <span className="flex items-center gap-0.5 text-warning"><AlertTriangle size={11} /> {ar ? 'غير مؤكد' : 'uncertain'}</span>}
        {outboundReal && (ds === 'failed' || ds === 'skipped') && (
          <span className="flex items-center gap-0.5 text-danger" title={deliveryError}><AlertTriangle size={11} /> {ds === 'skipped' ? (ar ? 'لم يُرسل' : 'not sent') : (ar ? 'فشل الإرسال' : 'failed')}</span>
        )}
      </span>
      {images.length > 0 && (
        <div className={`mb-1 flex max-w-full flex-wrap gap-1.5 ${customer ? 'justify-start' : 'justify-end'}`}>
          {images.map((a, i) => (
            <a key={i} href={a.url} target="_blank" rel="noreferrer">
              <img src={a.url} alt="" className="max-h-56 max-w-[260px] rounded-lg border border-line object-cover" loading="lazy" />
            </a>
          ))}
        </div>
      )}
      {(m.body || images.length === 0) && (
        <div className={`max-w-full whitespace-pre-wrap wrap-break-word rounded-xl px-3.5 py-2 text-sm leading-relaxed shadow-card sm:max-w-[78%] ${
          customer
            ? 'rounded-ss-sm border border-line bg-surface2 text-fg'
            : m.is_internal_suggestion
              ? 'rounded-se-sm border border-dashed border-accent/50 bg-accent/5 text-muted'
              : m.sender_type === 'ai'
                ? 'rounded-se-sm border border-accent/30 bg-accent/10 text-fg'
                : m.sender_type === 'human'
                  ? 'rounded-se-sm bg-accent-grad text-black'
                  : 'mx-auto border border-line bg-surface2 text-faint text-xs' /* system */
        }`} dir="auto">
          {m.body || '—'}
        </div>
      )}
    </div>
  );
}

function ProductSearch({ ar, onPick, onClose }: { ar: boolean; onPick: (p: FoundProduct) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<FoundProduct[]>([]);
  const [loading, setLoading] = useState(false);

  async function run(query: string) {
    setLoading(true);
    const res = await fetch(`/api/products/search?q=${encodeURIComponent(query)}`);
    const d = await res.json().catch(() => ({ rows: [] }));
    setRows(d.rows ?? []);
    setLoading(false);
  }

  return (
    <div className="border-t border-line bg-surface2/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="pointer-events-none absolute inset-y-0 my-auto inset-s-3 text-faint" />
          <input
            autoFocus value={q}
            onChange={(e) => { setQ(e.target.value); run(e.target.value); }}
            placeholder={ar ? 'ابحث عن منتج لإرفاقه…' : 'Search a product to attach…'}
            dir="auto" className="input ps-9 h-9"
          />
        </div>
        <button onClick={onClose} className="btn-subtle h-9 w-9 p-0"><X size={15} /></button>
      </div>
      <div className="scroll-thin max-h-44 space-y-1 overflow-y-auto">
        {loading ? (
          <p className="py-3 text-center text-xs text-faint">{ar ? 'بحث…' : 'Searching…'}</p>
        ) : rows.length === 0 ? (
          <p className="py-3 text-center text-xs text-faint">{q ? (ar ? 'لا نتائج' : 'No results') : ar ? 'اكتب للبحث' : 'Type to search'}</p>
        ) : (
          rows.map((p) => (
            <button key={p.id} onClick={() => onPick(p)} className="flex w-full items-center gap-2.5 rounded-lg border border-line bg-surface p-2 text-start transition hover:border-accent/40">
              <Thumb url={p.image} />
              <span className="min-w-0 flex-1">
                <span className="block wrap-break-word text-sm font-medium text-fg" dir="auto">{p.name}</span>
                {p.original_name && <span className="block truncate text-[11px] text-muted" title={p.original_name}>{p.original_name}</span>}
                <span className="ltr-nums block text-xs text-faint">{p.price != null ? `${p.price} د.ل` : '—'}</span>
              </span>
              <Plus size={15} className="text-accent" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
