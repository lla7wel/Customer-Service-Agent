'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bot, Check, ChevronLeft, CircleAlert, Clock3, Code2, Eye, FlaskConical,
  History, ScanSearch, Languages, Loader2, MemoryStick, MessageCircle,
  PackageSearch, RefreshCw, Save, Search, ShoppingBag, Sparkles,
} from 'lucide-react';
import Playground from './Playground';
import type { Locale } from '@/lib/i18n/config';

interface TaskPrompt { task_key:string; title:string; prompt:string; enabled:boolean; updated_at:string }
interface LintIssue { code:string; level:'error'|'warning'; message:string }
const AREAS = [
  {id:'replies',title:'ردود العملاء',en:'Customer Replies',icon:MessageCircle,tasks:['customer_reply'],desc:'النبرة العربية الليبية، الإجابات المختصرة، والحقائق المؤكدة.'},
  {id:'search',title:'بحث واقتراح المنتجات',en:'Product Search & Recommendations',icon:PackageSearch,tasks:['product_recommendation'],desc:'اختيار العائلة الصحيحة، الأسعار المؤكدة، والأسئلة التوضيحية المفيدة.'},
  {id:'handoff',title:'اكتشاف الطلب والتسليم',en:'Order Detection & Handoff',icon:ShoppingBag,tasks:['handoff_reply'],desc:'عدم تأكيد الطلب، ذكر واتساب مرة واحدة، واستمرار خدمة العميل.'},
  {id:'copy',title:'النص التسويقي',en:'Marketing Copy',icon:Languages,tasks:['campaign_caption'],desc:'عبارات وكابشن عربية ليبية قصيرة لاستوديو المحتوى.'},
  {id:'visuals',title:'التصاميم التسويقية',en:'Marketing Visuals',icon:Sparkles,tasks:['campaign_image','campaign_image_verify'],desc:'مشاهد تجارية واقعية، حفظ المنتج، النص والسعر والعلامة.'},
  {id:'matching',title:'مطابقة الصور',en:'Image Matching',icon:ScanSearch,tasks:['vision_describe','vision_rank'],desc:'تحليل الصورة وترتيب المنتجات الأقرب من الكتالوج من دون تخمين.'},
  {id:'memory',title:'الذاكرة',en:'Memory',icon:MemoryStick,tasks:['memory_summary'],desc:'تلخيص المحادثة وحفظ السياق الضروري للردود القادمة.'},
];
const TASK_LABEL:Record<string,string>={customer_reply:'ردود العملاء',product_recommendation:'اقتراح المنتجات',handoff_reply:'التسليم عند نية الطلب',vision_describe:'تحليل صورة العميل',vision_rank:'ترتيب المطابقات',memory_summary:'تلخيص الذاكرة',campaign_caption:'النص التسويقي',campaign_image:'إنشاء التصميم',campaign_image_verify:'فحص التصميم'};

export default function AiBehaviors({taskPrompts,locale,geminiConnected,owner,initialTab='guided'}:{taskPrompts:TaskPrompt[];locale:Locale;geminiConnected:boolean;owner:boolean;initialTab?:string}){
  const ar=locale==='ar'; const [tab,setTab]=useState(initialTab==='test'?'test':'guided'); const [rows,setRows]=useState(taskPrompts);
  const [selected,setSelected]=useState(taskPrompts[0]?.task_key||'customer_reply');
  const selectedRow=rows.find(r=>r.task_key===selected);
  const [query,setQuery]=useState('');
  const filtered=useMemo(()=>rows.filter(r=>(TASK_LABEL[r.task_key]||r.title).toLowerCase().includes(query.toLowerCase())),[rows,query]);
  return <div>
    <div className="mb-5 flex max-w-full gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1">
      <Tab active={tab==='guided'} onClick={()=>setTab('guided')} icon={Bot} label={ar?'التحكم المبسّط':'Guided controls'}/>
      {owner&&<Tab active={tab==='advanced'} onClick={()=>setTab('advanced')} icon={Code2} label={ar?'متقدم للمالك':'Owner advanced'}/>}
      <Tab active={tab==='test'} onClick={()=>setTab('test')} icon={FlaskConical} label={ar?'مركز الاختبار':'Test Center'}/>
      <span className={`ms-auto hidden items-center gap-2 rounded-lg px-3 text-xs sm:flex ${geminiConnected?'text-success':'text-warning'}`}><span className={`h-2 w-2 rounded-full ${geminiConnected?'bg-success':'bg-warning'}`}/>{geminiConnected?'Gemini متصل':'Gemini غير متصل'}</span>
    </div>
    {tab==='guided'&&<Guided rows={rows} ar={ar} test={(task)=>{setSelected(task);setTab('test');}}/>}
    {tab==='advanced'&&owner&&<div className="grid gap-4 lg:grid-cols-[270px_minmax(0,1fr)]"><aside className="rounded-2xl border border-line bg-surface p-3"><div className="relative mb-2"><Search size={15} className="absolute end-3 top-3.5 text-faint"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="ابحث في المهام" className="input pe-9"/></div><div className="space-y-1">{filtered.map(r=><button key={r.task_key} onClick={()=>setSelected(r.task_key)} className={`flex min-h-12 w-full items-center justify-between rounded-xl px-3 text-start text-sm ${selected===r.task_key?'bg-navy text-white':'text-muted hover:bg-surface2'}`}><span>{TASK_LABEL[r.task_key]||r.title}</span><ChevronLeft size={14}/></button>)}</div></aside><AdvancedEditor key={selected} row={selectedRow} rows={rows} setRows={setRows}/></div>}
    {tab==='test'&&<div className="space-y-4"><div className="rounded-2xl border border-line bg-surface p-4"><div className="flex items-start gap-3"><FlaskConical className="text-navy" size={21}/><div><h2 className="font-bold text-fg">مركز اختبار آمن</h2><p className="text-sm leading-6 text-muted">اختبر الردود ومطابقة الصور والنصوص. لا تُرسل أي رسالة أو منشور لأي عميل.</p></div></div></div><Playground locale={locale}/></div>}
  </div>;
}

function Guided({rows,ar,test}:{rows:TaskPrompt[];ar:boolean;test:(task:string)=>void}){return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{AREAS.map(area=>{const Icon=area.icon;const areaRows=rows.filter(r=>area.tasks.includes(r.task_key));const healthy=areaRows.length===area.tasks.length&&areaRows.every(r=>r.enabled&&r.prompt.trim());return <section key={area.id} className="flex min-h-56 flex-col rounded-2xl border border-line bg-surface p-5 shadow-card"><div className="flex items-start justify-between"><span className="grid h-11 w-11 place-items-center rounded-xl bg-navy/8 text-navy"><Icon size={20}/></span><span className={healthy?'badge-good':'badge-warn'}>{healthy?<><Check size={12}/> جاهز</>:<><CircleAlert size={12}/> يحتاج ضبط</>}</span></div><h2 className="mt-5 text-base font-bold text-fg">{ar?area.title:area.en}</h2><p className="mt-1 flex-1 text-sm leading-6 text-muted">{area.desc}</p><div className="mt-4 flex items-center justify-between border-t border-line pt-3"><span className="text-xs text-faint">{areaRows.length} {areaRows.length===1?'مهمة':'مهام'}</span><button onClick={()=>test(area.tasks[0])} className="btn-ghost min-h-11"><FlaskConical size={15}/> اختبار</button></div></section>})}</div>}

function AdvancedEditor({row,rows,setRows}:{row?:TaskPrompt;rows:TaskPrompt[];setRows:(r:TaskPrompt[])=>void}){
  const [prompt,setPrompt]=useState(row?.prompt||''); const [preview,setPreview]=useState<any>(null); const [lint,setLint]=useState<LintIssue[]>([]); const [busy,setBusy]=useState<string|null>(null); const [error,setError]=useState<string|null>(null); const [versions,setVersions]=useState<any[]|null>(null);
  useEffect(()=>{if(!row)return;setPrompt(row.prompt);setVersions(null);fetch(`/api/ai/tasks?task=${row.task_key}`).then(r=>r.json()).then(d=>{setPreview(d.preview);setLint(d.lint||[]);});},[row]);
  if(!row)return <div className="rounded-2xl border border-line bg-surface p-8 text-muted">لا توجد مهمة.</div>;
  const save=async()=>{setBusy('save');setError(null);const res=await fetch('/api/ai/tasks',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({task_key:row.task_key,prompt})});const data=await res.json();setLint(data.lint||[]);if(res.ok){setRows(rows.map(r=>r.task_key===row.task_key?{...r,prompt}:r));const fresh=await fetch(`/api/ai/tasks?task=${row.task_key}`).then(r=>r.json());setPreview(fresh.preview);}else setError(data.error==='prompt_validation_failed'?'أصلح أخطاء التحقق قبل الحفظ.':data.detail||data.error);setBusy(null);};
  const loadVersions=async()=>{setBusy('history');const d=await fetch(`/api/ai/tasks/versions?task=${row.task_key}`).then(r=>r.json());setVersions(d.versions||[]);setBusy(null);};
  const restore=async(id:number)=>{setBusy(`restore:${id}`);await fetch('/api/ai/tasks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version_id:id})});const d=await fetch(`/api/ai/tasks?task=${row.task_key}`).then(r=>r.json());setPrompt(d.row.prompt);setRows(rows.map(r=>r.task_key===row.task_key?d.row:r));setPreview(d.preview);setLint(d.lint||[]);setVersions(null);setBusy(null);};
  return <section className="min-w-0 rounded-2xl border border-line bg-surface p-5 shadow-card"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold text-sand-dark">إعداد إنتاجي موحّد</p><h2 className="mt-1 text-xl font-bold text-fg">{TASK_LABEL[row.task_key]||row.title}</h2><p className="mt-1 text-xs text-muted">{row.task_key} · آخر تحديث {new Date(row.updated_at).toLocaleString('ar-LY')}</p></div><span className="badge-muted">~{Math.ceil(prompt.length/4)} token</span></div>
    <label className="mt-5 block"><span className="mb-2 block text-sm font-bold text-fg">برومبت المهمة الكامل</span><textarea value={prompt} onChange={e=>setPrompt(e.target.value)} rows={18} dir="auto" className="input resize-y font-mono text-xs leading-6"/></label>
    <div className="mt-3 space-y-2">{lint.length===0?<p className="flex items-center gap-2 text-sm text-success"><Check size={15}/> لا توجد تناقضات ظاهرة</p>:lint.map((x,i)=><p key={`${x.code}-${i}`} className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${x.level==='error'?'bg-danger/8 text-danger':'bg-warning/8 text-warning'}`}><CircleAlert className="mt-0.5 shrink-0" size={14}/>{x.message}</p>)}</div>
    {error&&<p className="mt-3 text-sm text-danger">{error}</p>}
    <div className="mt-4 flex flex-wrap gap-2"><button onClick={save} disabled={busy!==null} className="btn-primary min-h-11">{busy==='save'?<Loader2 className="animate-spin" size={15}/>:<Save size={15}/>} حفظ ونشر فوراً</button><button onClick={loadVersions} disabled={busy!==null} className="btn-secondary"><History size={15}/> سجل النسخ</button></div>
    {preview&&<details className="mt-5 rounded-xl border border-line"><summary className="flex min-h-12 cursor-pointer items-center gap-2 px-4 text-sm font-bold text-fg"><Eye size={15}/> معاينة البرومبت الفعّال <span className="ms-auto text-xs font-normal text-muted">{preview.approximate_tokens} token</span></summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap border-t border-line bg-surface2 p-4 text-xs leading-5" dir="auto">{preview.effective_system_instruction}</pre></details>}
    {versions&&<div className="mt-4 rounded-xl border border-line p-3"><h3 className="mb-2 text-sm font-bold text-fg">النسخ السابقة</h3>{versions.length===0?<p className="text-xs text-muted">لا توجد نسخ سابقة.</p>:<div className="max-h-72 space-y-2 overflow-auto">{versions.map(v=><div key={v.id} className="flex items-center gap-2 rounded-lg bg-surface2 p-2 text-xs"><span className="min-w-0 flex-1 text-muted">#{v.id} · {v.note||'نسخة محفوظة'} · {v.saved_by_username||'النظام'}<small className="block"><Clock3 className="me-1 inline" size={11}/>{new Date(v.created_at).toLocaleString('ar-LY')}</small></span><button onClick={()=>restore(Number(v.id))} disabled={busy!==null} className="btn-ghost"><RefreshCw size={13}/> استعادة</button></div>)}</div>}</div>}
  </section>;
}

function Tab({active,onClick,icon:Icon,label}:{active:boolean;onClick:()=>void;icon:typeof Bot;label:string}){return <button onClick={onClick} className={`flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition ${active?'bg-navy text-white':'text-muted hover:bg-surface2'}`}><Icon size={16}/>{label}</button>}
