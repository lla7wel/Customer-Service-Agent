'use client';
import { useEffect, useState } from 'react';
import { Bot, Info, X } from 'lucide-react';

export default function ConversationDetailsSheet({children,ar}:{children:React.ReactNode;ar:boolean}){
  const [open,setOpen]=useState(false);
  useEffect(()=>{document.body.style.overflow=open?'hidden':'';return()=>{document.body.style.overflow='';};},[open]);
  useEffect(()=>{if(!open)return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[open]);
  return <div className="mb-3 flex gap-2 lg:hidden"><button onClick={()=>setOpen(true)} className="btn-secondary flex-1"><Bot size={16}/>{ar?'الذاكرة ومعلومات العميل':'Memory and customer details'}</button>{open&&<div className="fixed inset-0 z-50"><button onClick={()=>setOpen(false)} className="absolute inset-0 bg-black/35 backdrop-blur-sm" aria-label="Close"/><section className="safe-b scroll-thin absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-3xl border-t border-line bg-bg p-4 shadow-2xl"><header className="sticky top-0 z-10 mb-3 flex items-center justify-between rounded-xl bg-bg/95 py-2 backdrop-blur"><div className="flex items-center gap-2"><Info size={18} className="text-navy"/><b className="text-fg">{ar?'تفاصيل المحادثة':'Conversation details'}</b></div><button onClick={()=>setOpen(false)} className="grid h-11 w-11 place-items-center rounded-xl bg-surface2"><X size={18}/></button></header><div className="space-y-3">{children}</div></section></div>}</div>;
}
