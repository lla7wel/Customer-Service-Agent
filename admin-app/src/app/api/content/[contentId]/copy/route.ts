import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'kysely';
import { requireAdminApi, badRequest, notFound } from '@/lib/api';
import { audit } from '@/lib/auth';
import { generateCaption, generatePhrase } from '@integrations/pipelines/content-create';
import { customerProductName } from '@integrations/util/product-display';

export const runtime='nodejs'; export const dynamic='force-dynamic';
export async function POST(req:NextRequest,props:{params:Promise<{contentId:string}>}){
  const auth=await requireAdminApi(req);if(!auth.ok)return auth.res;const {db,admin}=auth.ctx;const {contentId}=await props.params;
  const item=await db.selectFrom('content_items').select(['id','status','purpose','image_text_mode','image_text']).where('id','=',contentId).executeTakeFirst();if(!item)return notFound();if(!['draft','ready','failed'].includes(item.status))return badRequest('not_editable');
  const products=await db.selectFrom('content_products as cp').innerJoin('products as p','p.id','cp.product_id').select(['cp.new_price','cp.show_price','p.product_code','p.libyan_display_name','p.arabic_name','p.english_name','p.source_name','p.category','p.arabic_keywords','p.active_price']).where('cp.content_item_id','=',contentId).orderBy('cp.position').execute();
  const names=products.map(p=>customerProductName(p));
  const prices=products.filter(p=>item.purpose==='price_drop'?p.new_price!=null:p.show_price&&p.active_price!=null).map(p=>({name:customerProductName(p),oldPrice:item.purpose==='price_drop'?Number(p.active_price):null,newPrice:Number(item.purpose==='price_drop'?p.new_price:p.active_price)}));
  // None mode: caption only — never generate an on-image phrase. Caption
  // generation stays available and independent in every mode.
  const wantPhrase = item.image_text_mode !== 'none';
  const [phrase,caption]=await Promise.all([wantPhrase?generatePhrase(db,names,item.purpose):Promise.resolve(item.image_text),generateCaption(db,{productNames:names,purpose:item.purpose,prices})]);
  if(!phrase&&!caption)return NextResponse.json({error:'generation_unavailable',detail:'Gemini did not return copy.'},{status:503});
  await db.transaction().execute(async trx=>{await trx.updateTable('content_assets').set({selected_for_publish:false}).where('content_item_id','=',contentId).where('asset_role','=','output').execute();await trx.updateTable('content_items').set({image_text:wantPhrase?phrase:null,caption,config_revision:sql`config_revision + 1` as any,selected_generation_run_id:null,status:'draft',last_error:null}).where('id','=',contentId).execute();});
  await audit(db,admin,'content.copy_generate',{type:'content_item',id:contentId});return NextResponse.json({phrase:wantPhrase?phrase:null,caption});
}
