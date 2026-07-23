import { cookies } from 'next/headers';
import { SlidersHorizontal } from 'lucide-react';
import { PageHeader, Notice } from '@/components/ui';
import NotConnected from '@/components/NotConnected';
import { getT } from '@/lib/i18n/server';
import { databaseStatus, geminiStatus } from '@integrations/status';
import { getDb } from '@/lib/db';
import { requireAdmin, SESSION_COOKIE } from '@/lib/auth';
import AiBehaviors from '@/components/ai/AiBehaviors';

export const dynamic='force-dynamic';
export default async function AiControlPage(props:{searchParams:Promise<{tab?:string}>}){
  const {tab}=await props.searchParams;
  const {t,locale}=await getT(); const ar=locale==='ar'; const db=getDb(); const admin=await requireAdmin((await cookies()).get(SESSION_COOKIE)?.value);
  if(!db)return <div><PageHeader icon={SlidersHorizontal} title={t('nav_ai_control')}/><NotConnected status={databaseStatus()}/></div>;
  const rows=await db.selectFrom('ai_task_prompts').selectAll().orderBy('task_key').execute().catch(()=>[]);
  return <div><PageHeader icon={SlidersHorizontal} title={t('nav_ai_control')} subtitle={ar?'تحكم واضح في الردود والبحث والتسليم والتسويق والذاكرة':'Clear controls for replies, search, handoff, marketing and memory'}/>
    {!geminiStatus().configured&&<div className="mb-4"><Notice tone="warn">{ar?'Gemini غير متصل. يمكنك تعديل الإعدادات لكن الاختبارات لن تعمل.':'Gemini is not connected. Settings remain editable, but tests will not run.'}</Notice></div>}
    <AiBehaviors taskPrompts={rows as any} locale={locale} geminiConnected={geminiStatus().configured} owner={admin?.role==='owner'} initialTab={tab}/>
  </div>;
}
