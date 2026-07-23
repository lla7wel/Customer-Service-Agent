import Link from 'next/link';
/* eslint-disable @next/next/no-img-element -- media uses the configured public media host */
import { CalendarDays, ChevronLeft, ChevronRight, Clapperboard, Clock3, ImageIcon, TriangleAlert } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/ui';
import NotConnected from '@/components/NotConnected';
import AutoRefresh from '@/components/AutoRefresh';
import CreateContentButton from '@/components/content/CreateContentButton';
import { getT } from '@/lib/i18n/server';
import { databaseStatus } from '@integrations/status';
import { getDb } from '@/lib/db';
import { sql } from 'kysely';
import { utcToTripoliDisplay, tripoliLocalToUtc } from '@/lib/tripoli-time';

export const dynamic = 'force-dynamic';

const FILTERS = [
  ['all','الكل','All'], ['drafts','المسودات','Drafts'], ['ready','جاهز','Ready'],
  ['scheduled','مجدول','Scheduled'], ['publishing','قيد النشر','Publishing'],
  ['published','منشور','Published'], ['problems','مشاكل','Problems'],
] as const;
const STATUS: Record<string, { ar: string; en: string; tone: string }> = {
  draft: { ar:'مسودة', en:'Draft', tone:'badge-muted' }, generating: { ar:'قيد التوليد', en:'Generating', tone:'badge-muted' },
  ready: { ar:'جاهز', en:'Ready', tone:'badge-good' }, approved: { ar:'معتمد', en:'Approved', tone:'badge-muted' },
  scheduled: { ar:'مجدول', en:'Scheduled', tone:'badge-muted' }, publishing: { ar:'قيد النشر', en:'Publishing', tone:'badge-muted' },
  published: { ar:'منشور', en:'Published', tone:'badge-good' }, partially_published: { ar:'منشور جزئياً', en:'Partial', tone:'badge-warn' },
  failed: { ar:'مشكلة', en:'Problem', tone:'badge-warn' }, archived: { ar:'مؤرشف', en:'Archived', tone:'badge-muted' },
};
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const dateFor = (c: any) => new Date(c.scheduled_for || c.published_at || c.updated_at);

export default async function ContentStudioPage(props: { searchParams: Promise<{ filter?: string; month?: string; day?: string }> }) {
  const params = await props.searchParams;
  const filter = params.filter || 'all';
  const { locale } = await getT(); const ar = locale === 'ar';
  const db = getDb();
  if (!db) return <div><PageHeader icon={Clapperboard} title={ar ? 'استوديو المحتوى' : 'Content Studio'} /><NotConnected status={databaseStatus()} /></div>;

  const requested = /^\d{4}-\d{2}$/.test(params.month || '') ? `${params.month}-01T12:00:00` : new Date().toISOString();
  const month = new Date(requested);
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const monthEnd = new Date(month.getFullYear(), month.getMonth()+1, 0);
  const prev = new Date(month.getFullYear(), month.getMonth()-1, 1);
  const next = new Date(month.getFullYear(), month.getMonth()+1, 1);

  // The AUTHORITATIVE publication time for a published item is the latest
  // content_publications.published_at (audit finding #16), not updated_at.
  const publishedAtSub = sql<string>`(select max(pub.published_at) from content_publications pub where pub.content_item_id = ci.id and pub.status = 'published')`;
  // Placement date used by the calendar/agenda.
  const effectiveAt = sql<string>`coalesce(ci.scheduled_for, ${publishedAtSub}, ci.updated_at)`;

  let query = db.selectFrom('content_items as ci')
    .leftJoin('content_products as cp', 'cp.content_item_id', 'ci.id')
    .select((eb) => ['ci.id','ci.title','ci.content_type','ci.platforms','ci.purpose','ci.status','ci.scheduled_for','ci.updated_at','ci.last_error','ci.selected_generation_run_id',
      eb.fn.count<number>('cp.id').distinct().as('product_count'),
      publishedAtSub.as('published_at')])
    .groupBy('ci.id');
  const statusFilter: Record<string,string[]> = {
    drafts:['draft'], ready:['ready'], scheduled:['scheduled'], publishing:['approved','publishing'],
    published:['published'], problems:['failed','partially_published'],
  };
  if (statusFilter[filter]) query = query.where('ci.status','in',statusFilter[filter]);
  else query = query.where('ci.status','!=','archived');

  // Draft/ready/problem tabs are list views (all matching items, newest first);
  // date-oriented views are MONTH-SCOPED so a busy or older month never silently
  // drops items behind a global cap (audit finding #17).
  const listMode = ['drafts','ready','problems'].includes(filter);
  if (listMode) {
    query = query.orderBy('ci.updated_at','desc').limit(300);
  } else {
    const y = monthStart.getFullYear(); const mo = monthStart.getMonth();
    const first = `${y}-${pad(mo+1)}-01T00:00`;
    const nextFirst = mo === 11 ? `${y+1}-01-01T00:00` : `${y}-${pad(mo+2)}-01T00:00`;
    const rangeStartUtc = tripoliLocalToUtc(first)!;
    const rangeEndUtc = tripoliLocalToUtc(nextFirst)!;
    query = query
      .where(sql<boolean>`${effectiveAt} >= ${rangeStartUtc}::timestamptz`)
      .where(sql<boolean>`${effectiveAt} < ${rangeEndUtc}::timestamptz`)
      .orderBy(sql`${effectiveAt}`, 'asc')
      .limit(500);
  }
  const items = await query.execute();
  const ids = items.map((x) => x.id);
  const thumbnails = ids.length ? await db.selectFrom('content_assets').select(['content_item_id','public_url','selected_for_publish','position'])
    .where('content_item_id','in',ids).where('asset_role','=','output').where('public_url','is not',null).orderBy('selected_for_publish','desc').orderBy('position').execute() : [];
  const thumbByItem = new Map<string,string>();
  for (const asset of thumbnails) if (asset.public_url && !thumbByItem.has(asset.content_item_id)) thumbByItem.set(asset.content_item_id, asset.public_url);

  const cells: Date[] = [];
  const startOffset = (monthStart.getDay()+6)%7;
  for (let i=0; i<startOffset; i++) cells.push(new Date(month.getFullYear(),month.getMonth(),1-startOffset+i));
  for (let i=1; i<=monthEnd.getDate(); i++) cells.push(new Date(month.getFullYear(),month.getMonth(),i));
  while (cells.length%7) cells.push(new Date(month.getFullYear(),month.getMonth()+1,cells.length-startOffset-monthEnd.getDate()+1));
  const today = ymd(new Date());
  const agendaDay = params.day && /^\d{4}-\d{2}-\d{2}$/.test(params.day) ? params.day : today;
  const agenda = items.filter((c) => ymd(dateFor(c)) === agendaDay || (!c.scheduled_for && agendaDay === today)).slice(0,30);
  const monthLabel = new Intl.DateTimeFormat(ar ? 'ar-LY' : 'en-US',{month:'long',year:'numeric'}).format(monthStart);

  return <div className="pb-20 lg:pb-0">
    <AutoRefresh intervalMs={15000}/>
    <PageHeader icon={Clapperboard} title={ar ? 'استوديو المحتوى' : 'Content Studio'} subtitle={ar ? 'خطّط، أنشئ وانشر من مكان واحد' : 'Plan, create and publish from one place'} />
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <nav className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 pb-1" aria-label={ar ? 'تصفية المحتوى' : 'Content filters'}>{FILTERS.map(([id,a,e]) => <Link key={id} href={`/content-studio?filter=${id}&month=${ymd(monthStart).slice(0,7)}`} className={`min-h-11 shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition ${filter === id ? 'border-navy bg-navy text-white' : 'border-line bg-surface text-muted hover:bg-surface2'}`}>{ar?a:e}</Link>)}</nav>
      <CreateContentButton/>
    </div>

    <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
        <div className="flex items-center gap-2"><CalendarDays className="text-navy" size={20}/><div><h2 className="font-bold text-fg">{monthLabel}</h2><p className="text-xs text-muted">{ar ? 'تقويم النشر والمحتوى' : 'Publishing and content calendar'}</p></div></div>
        <div className="flex items-center gap-1"><Link href={`/content-studio?filter=${filter}&month=${ymd(prev).slice(0,7)}`} aria-label="Previous month" className="grid h-11 w-11 place-items-center rounded-xl border border-line hover:bg-surface2"><ChevronRight size={17}/></Link><Link href={`/content-studio?filter=${filter}&month=${ymd(new Date()).slice(0,7)}`} className="min-h-11 rounded-xl border border-line px-3 py-2.5 text-sm text-fg hover:bg-surface2">{ar?'اليوم':'Today'}</Link><Link href={`/content-studio?filter=${filter}&month=${ymd(next).slice(0,7)}`} aria-label="Next month" className="grid h-11 w-11 place-items-center rounded-xl border border-line hover:bg-surface2"><ChevronLeft size={17}/></Link></div>
      </header>
      <div className="hidden lg:block">
        <div className="grid grid-cols-7 border-b border-line bg-surface2/60 text-center text-xs font-semibold text-muted">{(ar?['الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت','الأحد']:['Mon','Tue','Wed','Thu','Fri','Sat','Sun']).map(d=><div key={d} className="p-2">{d}</div>)}</div>
        <div className="grid grid-cols-7">{cells.map((day) => { const key=ymd(day); const dayItems=items.filter((c)=>ymd(dateFor(c))===key).slice(0,3); const inMonth=day.getMonth()===monthStart.getMonth(); return <Link href={`/content-studio?filter=${filter}&month=${ymd(monthStart).slice(0,7)}&day=${key}`} key={key} className={`min-h-32 border-b border-e border-line p-2 transition hover:bg-surface2/50 ${!inMonth?'bg-surface2/30 text-faint':''} ${key===today?'ring-1 ring-inset ring-navy/30':''}`}><span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${key===today?'bg-navy text-white':''}`}>{day.getDate()}</span><div className="mt-1 space-y-1">{dayItems.map((c)=><div key={c.id} className="truncate rounded-md bg-surface2 px-1.5 py-1 text-[11px] text-fg"><span className={`me-1 inline-block h-1.5 w-1.5 rounded-full ${c.status==='failed'?'bg-danger':c.status==='published'?'bg-success':'bg-info'}`}/>{c.title || (ar?'بدون عنوان':'Untitled')}</div>)}{items.filter((c)=>ymd(dateFor(c))===key).length>3&&<span className="text-[10px] text-muted">+{items.filter((c)=>ymd(dateFor(c))===key).length-3}</span>}</div></Link>; })}</div>
      </div>
      <div className="border-t border-line p-4 lg:border-t-0">
        <div className="mb-3 flex items-center justify-between"><div><h3 className="font-bold text-fg">{ar?'جدول اليوم':'Daily agenda'}</h3><p className="text-xs text-muted">{new Intl.DateTimeFormat(ar?'ar-LY':'en-US',{dateStyle:'full'}).format(new Date(`${agendaDay}T12:00:00`))}</p></div></div>
        {agenda.length === 0 ? <div className="rounded-xl border border-dashed border-line p-7 text-center text-sm text-muted">{ar?'لا يوجد محتوى لهذا اليوم.':'No content for this day.'}</div> : <div className="space-y-2">{agenda.map((c)=><ContentRow key={c.id} c={c} thumb={thumbByItem.get(c.id)} ar={ar}/>)}</div>}
      </div>
    </section>

    {items.length === 0 && <div className="mt-4"><EmptyState icon={Clapperboard} title={ar?'لا يوجد محتوى هنا':'Nothing here yet'} hint={ar?'ابدأ بإنشاء منشور أو ستوري جديد.':'Start with a post or story.'}/></div>}
  </div>;
}

function ContentRow({ c, thumb, ar }: { c: any; thumb?: string; ar: boolean }) {
  const status = STATUS[c.status] || { ar:c.status,en:c.status,tone:'badge-muted' };
  return <Link href={`/content-studio/${c.id}`} className="group flex min-h-20 items-center gap-3 rounded-xl border border-line bg-surface p-2.5 transition hover:border-navy/25 hover:bg-surface2/40">
    <div className={`grid h-16 w-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface2 ${c.content_type==='story'?'aspect-[9/16]':'aspect-[4/5]'}`}>{thumb?<img src={thumb} alt="" className="h-full w-full object-cover"/>:<ImageIcon size={19} className="text-faint"/>}</div>
    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-bold text-fg">{c.title || (ar?'بدون عنوان':'Untitled')}</h3><span className={status.tone}>{ar?status.ar:status.en}</span></div><p className="mt-1 truncate text-xs text-muted">{(c.platforms||[]).map((p:string)=>p==='facebook'?'Facebook':'Instagram').join(' + ')} · {c.purpose==='price_drop'?(ar?'تخفيض سعر':'Price drop'):(ar?'عام':'General')} · {Number(c.product_count)} {ar?'منتج':'products'}</p>{c.last_error&&<p className="mt-1 flex items-center gap-1 whitespace-normal text-xs text-danger"><TriangleAlert size={12}/>{c.last_error}</p>}</div>
    <div className="hidden shrink-0 text-end sm:block"><p className="flex items-center gap-1 text-xs text-muted"><Clock3 size={13}/>{c.scheduled_for?utcToTripoliDisplay(c.scheduled_for):ar?'غير مجدول':'Unscheduled'}</p></div>
  </Link>;
}
