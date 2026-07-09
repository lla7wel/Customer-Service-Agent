'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Layers, Copy, Send, CalendarClock, AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react';
import { Card, SectionTitle, Badge } from '@/components/ui';
import { humanize } from '@/lib/format';
import type { Locale } from '@/lib/i18n/config';

interface Post {
  id: string;
  type: string;
  status: string;
  asset_ids: string[];
  fb_post_id: string | null;
  permalink_url: string | null;
  scheduled_for: string | null;
  error: string | null;
}

export default function PostComposer({
  campaignId,
  assetCount,
  posts,
  locale,
}: {
  campaignId: string;
  assetCount: number;
  posts: Post[];
  locale: Locale;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [mode, setMode] = useState<'single' | 'multiple'>('single');
  const [schedule, setSchedule] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ k: 'ok' | 'info' | 'err'; t: string } | null>(null);

  async function call(action: string, extra: Record<string, unknown> = {}) {
    const res = await fetch(`/api/campaigns/${campaignId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });
    return { res, d: await res.json().catch(() => ({})) };
  }

  async function prepare() {
    if (assetCount === 0) {
      setMsg({ k: 'info', t: ar ? 'ارفع صورة واحدة على الأقل أولاً.' : 'Upload at least one image first.' });
      return;
    }
    setBusy('prepare');
    setMsg(null);
    const { res, d } = await call('prepare_posts', { mode, scheduledFor: schedule || null });
    setBusy(null);
    if (res.ok) {
      setMsg({ k: 'ok', t: ar ? `تم تجهيز ${d.created} منشور (${mode === 'single' ? 'مجمّع' : 'منفصل'})` : `Prepared ${d.created} post(s)` });
      router.refresh();
    } else setMsg({ k: 'err', t: d?.error || 'Failed' });
  }

  async function publish(postId: string) {
    setBusy(postId);
    setMsg(null);
    const { res, d } = await call('publish_post', { postId });
    setBusy(null);
    setConfirmId(null);
    if (res.ok) {
      setMsg({ k: 'ok', t: ar ? 'تم النشر على فيسبوك' : 'Published to Facebook' });
      router.refresh();
    } else if (res.status === 503) {
      setMsg({ k: 'info', t: (ar ? 'Meta غير مربوط: ' : 'Meta not connected: ') + (d?.missing?.join(', ') || '') });
    } else {
      setMsg({ k: 'err', t: (ar ? 'فشل النشر — حُفظت المسودة. ' : 'Publish failed — draft saved. ') + (d?.detail || d?.error || '') });
    }
  }

  const multiDisabled = assetCount < 2;

  return (
    <Card>
      <SectionTitle icon={Send} title={ar ? 'النشر على فيسبوك' : 'Facebook posts'} count={posts.length || undefined} />

      {/* decision */}
      <div className="grid grid-cols-2 gap-2">
        <ModeCard
          active={mode === 'single'}
          onClick={() => setMode('single')}
          icon={<Layers size={16} />}
          title={ar ? 'منشور واحد' : 'One post'}
          desc={ar ? 'كاروسيل بكل الصور' : 'Carousel with all images'}
        />
        <ModeCard
          active={mode === 'multiple'}
          onClick={() => !multiDisabled && setMode('multiple')}
          disabled={multiDisabled}
          icon={<Copy size={16} />}
          title={ar ? 'منشورات منفصلة' : 'Separate posts'}
          desc={ar ? 'منشور لكل صورة' : 'One post per image'}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex-1">
          <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted"><CalendarClock size={13} /> {ar ? 'جدولة (اختياري)' : 'Schedule (optional)'}</span>
          <input type="datetime-local" value={schedule} onChange={(e) => setSchedule(e.target.value)} className="input h-9" />
        </label>
        <button onClick={prepare} disabled={busy !== null} className="btn-primary h-9">
          {busy === 'prepare' ? '…' : schedule ? (ar ? 'جدولة المنشورات' : 'Schedule posts') : ar ? 'تجهيز المنشورات' : 'Prepare posts'}
        </button>
      </div>

      {msg && <p className={`mt-2 text-xs ${msg.k === 'ok' ? 'text-success' : msg.k === 'info' ? 'text-info' : 'text-danger'}`}>{msg.t}</p>}

      {/* posts list */}
      {posts.length > 0 && (
        <ul className="mt-4 space-y-2">
          {posts.map((p, i) => (
            <li key={p.id} className="rounded-lg border border-line bg-surface2 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-fg">{ar ? 'منشور' : 'Post'} {i + 1}</span>
                  <Badge tone="neutral">{humanize(p.type)} · {p.asset_ids?.length ?? 0} {ar ? 'صورة' : 'img'}</Badge>
                  <PostStatus status={p.status} ar={ar} />
                </div>
                {p.status === 'published' ? (
                  p.fb_post_id ? (
                    <a href={`https://facebook.com/${p.fb_post_id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                      <ExternalLink size={12} /> {ar ? 'عرض' : 'View'}
                    </a>
                  ) : null
                ) : confirmId === p.id ? (
                  <span className="flex items-center gap-1.5">
                    <button onClick={() => publish(p.id)} disabled={busy !== null} className="btn bg-success/20 text-success hover:bg-success/30 h-7 px-2.5 text-xs">{busy === p.id ? '…' : ar ? 'تأكيد النشر' : 'Confirm'}</button>
                    <button onClick={() => setConfirmId(null)} className="btn-subtle h-7 px-2.5 text-xs">{ar ? 'إلغاء' : 'Cancel'}</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmId(p.id)} className="btn-primary h-7 px-2.5 text-xs"><Send size={12} className="rtl-flip" /> {p.scheduled_for ? (ar ? 'انشر الآن' : 'Publish now') : ar ? 'نشر' : 'Publish'}</button>
                )}
              </div>
              {p.error && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-danger"><AlertTriangle size={13} /> {p.error}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ModeCard({ active, onClick, disabled, icon, title, desc }: { active: boolean; onClick: () => void; disabled?: boolean; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl border p-3 text-start transition ${
        disabled ? 'cursor-not-allowed border-line opacity-40' : active ? 'border-accent/50 bg-accent/10' : 'border-line bg-surface hover:border-faint'
      }`}
    >
      <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${active ? 'bg-accent text-black' : 'bg-surface2 text-muted'}`}>{icon}</span>
      <p className="mt-2 text-sm font-medium text-fg">{title}</p>
      <p className="text-xs text-muted">{desc}</p>
    </button>
  );
}

function PostStatus({ status, ar }: { status: string; ar: boolean }) {
  const tone = status === 'published' ? 'good' : status === 'failed' ? 'bad' : status === 'scheduled' ? 'info' : status === 'publishing' ? 'warn' : 'neutral';
  return (
    <Badge tone={tone as any}>
      {status === 'published' && <CheckCircle2 size={12} />}
      {humanize(status)}
    </Badge>
  );
}
