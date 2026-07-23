'use client';
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import { ImageUp, Loader2, ShieldCheck } from 'lucide-react';

export default function BrandKitEditor() {
  const [kit,setKit] = useState<any>(null); const [busy,setBusy] = useState(false); const [error,setError] = useState<string|null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(()=>{ fetch('/api/settings/brand-kit').then(r=>r.json()).then(d=>setKit(d.kit)); },[]);
  const upload = async (file: File) => { setBusy(true); setError(null); const form=new FormData(); form.append('logo',file); const res=await fetch('/api/settings/brand-kit',{method:'POST',body:form}); const data=await res.json(); if(res.ok)setKit(data.kit);else setError(data.detail||data.error||'فشل رفع الشعار'); setBusy(false); };
  return <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
    <div className="rounded-2xl border border-line bg-surface2/50 p-5"><div className="grid aspect-video place-items-center rounded-xl border border-dashed border-line bg-white p-5">{kit?.logo_public_url?<img src={kit.logo_public_url} alt="English Home Libya logo" className="max-h-full max-w-full object-contain"/>:<div className="text-center"><b className="font-serif text-xl tracking-[.16em] text-[#123553]">ENGLISH HOME</b><span className="mt-1 block text-xs tracking-[.32em] text-[#123553]">LIBYA</span></div>}</div><p className="mt-3 text-xs leading-5 text-muted">{kit?.logo_public_url?'الشعار الرسمي المستخدم في التصاميم.':'لا يوجد شعار مرفوع؛ يستخدم النظام كلمة ENGLISH HOME LIBYA بهدوء.'}</p></div>
    <div><h3 className="text-lg font-bold text-fg">شعار العلامة</h3><p className="mt-1 max-w-xl text-sm leading-6 text-muted">ارفع النسخة الرسمية بخلفية شفافة. لا يحذف النظام أي شعار سابق من التخزين، ويُسجل كل تغيير في سجل التدقيق.</p><input ref={input} hidden type="file" accept="image/png,image/webp" onChange={(e)=>{const f=e.target.files?.[0];if(f)upload(f);e.target.value='';}}/><button onClick={()=>input.current?.click()} disabled={busy} className="btn-primary mt-4 min-h-12">{busy?<Loader2 className="animate-spin" size={17}/>:<ImageUp size={17}/>} رفع شعار PNG أو WebP</button>{error&&<p className="mt-2 text-sm text-danger">{error}</p>}<div className="mt-5 flex items-start gap-2 rounded-xl border border-line p-3 text-xs leading-5 text-muted"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-success"/>يُرسل الشعار كمرجع هوية إلى نموذج الصور ويُفحص ظهوره في النتيجة النهائية.</div></div>
  </div>;
}
