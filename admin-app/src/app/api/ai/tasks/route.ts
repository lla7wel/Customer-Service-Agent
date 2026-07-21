import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi, badRequest, forbidden, notFound } from '@/lib/api';
import { audit } from '@/lib/auth';
import { compilePrompt, publicPromptPreview, type AiTask } from '@integrations/prompt-compiler';
import { lintPrompt } from '@integrations/prompt-lint';
import { loadBehaviorsWith } from '@integrations/ai-behaviors';

export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
const TASKS: AiTask[] = ['customer_reply','product_recommendation','handoff_reply','vision_describe','vision_rank','memory_summary','campaign_caption','campaign_image','campaign_image_verify'];

export async function GET(req: NextRequest) {
  const auth=await requireAdminApi(req); if(!auth.ok)return auth.res;
  const {db,admin}=auth.ctx; const key=req.nextUrl.searchParams.get('task') as AiTask|null;
  if(key && !TASKS.includes(key))return badRequest('invalid_task');
  if(key){ const map=await loadBehaviorsWith(db); const preview=publicPromptPreview(compilePrompt(map,key,{})); const row=await db.selectFrom('ai_task_prompts').selectAll().where('task_key','=',key).executeTakeFirst(); return NextResponse.json({row,preview,lint:lintPrompt(key,row?.prompt||''),canEditRaw:admin.role==='owner'}); }
  const rows=await db.selectFrom('ai_task_prompts').selectAll().orderBy('task_key').execute();
  return NextResponse.json({rows:rows.map(r=>({...r,lint:lintPrompt(r.task_key,r.prompt)})),canEditRaw:admin.role==='owner'});
}

export async function PATCH(req: NextRequest) {
  const auth=await requireAdminApi(req); if(!auth.ok)return auth.res;
  const {db,admin}=auth.ctx; if(admin.role!=='owner')return forbidden('Only the owner can edit raw production prompts.');
  const body=await req.json().catch(()=>({})); const key=String(body.task_key||'') as AiTask; const prompt=String(body.prompt||'');
  if(!TASKS.includes(key))return badRequest('invalid_task');
  const lint=lintPrompt(key,prompt); if(lint.some(x=>x.level==='error'))return NextResponse.json({error:'prompt_validation_failed',lint},{status:400});
  const current=await db.selectFrom('ai_task_prompts').selectAll().where('task_key','=',key).executeTakeFirst(); if(!current)return notFound();
  await db.transaction().execute(async trx=>{ await trx.insertInto('ai_task_prompt_versions').values({task_key:key,title:current.title,prompt:current.prompt,enabled:current.enabled,saved_by:admin.id,note:'before edit'}).execute(); await trx.updateTable('ai_task_prompts').set({prompt,updated_by:admin.id}).where('task_key','=',key).execute(); });
  await audit(db,admin,'ai.task_prompt_update',{type:'ai_task_prompt',id:key,detail:{characters:prompt.length}});
  return NextResponse.json({ok:true,lint});
}

export async function POST(req: NextRequest) {
  const auth=await requireAdminApi(req); if(!auth.ok)return auth.res;
  const {db,admin}=auth.ctx; if(admin.role!=='owner')return forbidden();
  const body=await req.json().catch(()=>({})); const versionId=Number(body.version_id); if(!Number.isFinite(versionId))return badRequest('missing_version');
  const version=await db.selectFrom('ai_task_prompt_versions').selectAll().where('id','=',versionId).executeTakeFirst(); if(!version)return notFound();
  const current=await db.selectFrom('ai_task_prompts').selectAll().where('task_key','=',version.task_key).executeTakeFirst(); if(!current)return notFound();
  await db.transaction().execute(async trx=>{ await trx.insertInto('ai_task_prompt_versions').values({task_key:current.task_key,title:current.title,prompt:current.prompt,enabled:current.enabled,saved_by:admin.id,note:`before restoring #${versionId}`}).execute(); await trx.updateTable('ai_task_prompts').set({title:version.title,prompt:version.prompt,enabled:version.enabled,updated_by:admin.id}).where('task_key','=',version.task_key).execute(); });
  await audit(db,admin,'ai.task_prompt_restore',{type:'ai_task_prompt',id:version.task_key,detail:{version_id:versionId}}); return NextResponse.json({ok:true});
}
