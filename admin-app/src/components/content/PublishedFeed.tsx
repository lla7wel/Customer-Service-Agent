'use client';

/* eslint-disable @next/next/no-img-element -- media uses the configured public media host */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, MessageCircle, ExternalLink, Facebook, Instagram, Send, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface Post {
  id: string; platform: 'facebook' | 'instagram'; source: 'app' | 'external'; post_type: string | null;
  caption: string | null; media_type: string | null; media_url: string | null; media: any; permalink: string | null;
  provider_created_at: string | null; engagement: any; comment_count: number; provider_deleted: boolean;
}
interface Comment {
  id: string; author_name: string | null; body: string | null; commented_at: string | null;
  reply_status: string | null; reply_text: string | null; reply_error: string | null; reply_source: string | null;
}

const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString('ar-LY', { timeZone: 'Africa/Tripoli', dateStyle: 'medium', timeStyle: 'short' }) : '—';

export default function PublishedFeed() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const loadPage = useCallback(async (before: string | null) => {
    setLoading(true);
    try {
      const url = `/api/content/feed?limit=12${before ? `&before=${encodeURIComponent(before)}` : ''}`;
      const res = await fetch(url);
      const d = await res.json();
      setPosts((p) => before ? [...p, ...(d.posts ?? [])] : (d.posts ?? []));
      setCursor(d.nextCursor ?? null);
      setHasMore(Boolean(d.hasMore));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadPage(null); }, [loadPage]);

  const sync = async () => {
    setSyncing(true);
    try { await fetch('/api/content/feed', { method: 'POST' }); await loadPage(null); }
    finally { setSyncing(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">منشورات فيسبوك وإنستغرام — من التطبيق والنشر اليدوي.</p>
        <button onClick={sync} disabled={syncing} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line px-3 text-sm text-muted transition hover:text-fg">{syncing ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />} مزامنة</button>
      </div>

      {posts.length === 0 && !loading && <p className="rounded-xl border border-line bg-surface2/40 p-6 text-center text-sm text-muted">لا توجد منشورات مُزامنة بعد. اضغط «مزامنة» أو انتظر المزامنة التلقائية.</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        {posts.map((post) => (
          <article key={post.id} className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            <header className="flex items-center justify-between gap-2 border-b border-line p-3">
              <span className="flex items-center gap-2 text-sm font-semibold text-fg">
                {post.platform === 'facebook' ? <Facebook size={16} className="text-[#1877F2]" /> : <Instagram size={16} className="text-[#E4405F]" />}
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${post.source === 'app' ? 'bg-accent/12 text-accent' : 'bg-surface2 text-muted'}`}>{post.source === 'app' ? 'من التطبيق' : 'نشر خارجي'}</span>
              </span>
              <time className="text-[11px] text-muted">{fmt(post.provider_created_at)}</time>
            </header>
            {post.media_url && <img src={post.media_url} alt="" className="aspect-square w-full bg-surface2 object-cover" loading="lazy" />}
            <div className="p-3">
              {post.caption && <p className="mb-2 line-clamp-4 whitespace-pre-wrap text-sm text-fg" dir="auto">{post.caption}</p>}
              <div className="flex items-center gap-3 text-xs text-muted">
                <span className="flex items-center gap-1"><MessageCircle size={13} /> {post.comment_count}</span>
                {typeof post.engagement?.reactions === 'number' && <span>👍 {post.engagement.reactions}</span>}
                {typeof post.engagement?.likes === 'number' && <span>❤️ {post.engagement.likes}</span>}
                {post.permalink && <a href={post.permalink} target="_blank" rel="noreferrer" className="ms-auto inline-flex items-center gap-1 text-accent hover:underline">فتح <ExternalLink size={12} /></a>}
              </div>
              <button onClick={() => setOpen(open === post.id ? null : post.id)} className="mt-2 min-h-10 text-sm font-medium text-navy hover:underline">
                {open === post.id ? 'إخفاء التعليقات' : `عرض التعليقات (${post.comment_count})`}
              </button>
              {open === post.id && <CommentThread postId={post.id} />}
            </div>
          </article>
        ))}
      </div>

      {hasMore && <button onClick={() => loadPage(cursor)} disabled={loading} className="btn-secondary mx-auto min-h-11">{loading ? <Loader2 className="animate-spin" size={16} /> : null} تحميل المزيد</button>}
    </div>
  );
}

function CommentThread({ postId }: { postId: string }) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [autoEligible, setAutoEligible] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/content/feed/${postId}/comments?limit=20`);
    const d = await res.json();
    setComments(d.comments ?? []);
    setAutoEligible(Boolean(d.auto_reply_eligible));
  }, [postId]);
  useEffect(() => { load(); }, [load]);

  const reply = async (commentId: string) => {
    const text = (drafts[commentId] ?? '').trim();
    if (!text) return;
    setBusy(commentId);
    try {
      const res = await fetch(`/api/content/feed/comments/${commentId}/reply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
      await res.json().catch(() => ({}));
      setDrafts((d) => ({ ...d, [commentId]: '' }));
      await load();
    } finally { setBusy(null); }
  };

  if (!comments) return <div className="py-3 text-center text-muted"><Loader2 className="mx-auto animate-spin" size={16} /></div>;
  return (
    <div className="mt-2 space-y-2 border-t border-line pt-2">
      {!autoEligible && <p className="text-[11px] text-faint">الرد التلقائي يعمل فقط على منشورات التطبيق. هذا منشور خارجي — يمكن الرد يدوياً.</p>}
      {comments.length === 0 && <p className="py-2 text-center text-xs text-muted">لا توجد تعليقات.</p>}
      {comments.map((c) => (
        <div key={c.id} className="rounded-lg bg-surface2/50 p-2 text-sm">
          <p className="text-xs font-semibold text-fg" dir="auto">{c.author_name || 'زائر'} <span className="font-normal text-faint">· {fmt(c.commented_at)}</span></p>
          <p className="whitespace-pre-wrap text-fg" dir="auto">{c.body}</p>
          {c.reply_status === 'sent' && <p className="mt-1 flex items-center gap-1 text-[11px] text-success"><CheckCircle2 size={12} /> تم الرد{c.reply_source === 'manual' ? ' يدوياً' : ' تلقائياً'}: <span dir="auto">{c.reply_text}</span></p>}
          {c.reply_status === 'failed' && <p className="mt-1 flex items-center gap-1 text-[11px] text-danger"><AlertTriangle size={12} /> فشل الرد: {c.reply_error}</p>}
          {c.reply_status !== 'sent' && (
            <div className="mt-1.5 flex gap-1.5">
              <input value={drafts[c.id] ?? ''} onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))} placeholder="رد يدوي…" dir="auto" className="input min-h-10 flex-1 text-sm" />
              <button onClick={() => reply(c.id)} disabled={busy === c.id || !(drafts[c.id] ?? '').trim()} className="btn-primary min-h-10 px-3">{busy === c.id ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
