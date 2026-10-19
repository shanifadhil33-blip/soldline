import 'server-only';
import { z } from 'zod';
import { createSchema } from './approvals/model';
import { copy } from './backend-a5';
import { buildDraft, draftRequest } from './agent-drafts';
import { agentWording } from './ai/chain';
import { assertCan, type Member } from './permissions';
import { memberCopy, permittedData } from './backend-a5';
import type { SqlConnection } from './db/withMember';
export const cardDraft=z.object({action:z.enum(['approve_plan_correction','retry_recovery','client_reminder','scope_change']),approval:createSchema, recoveryId:z.uuid().optional()}).strict().superRefine((draft,ctx)=>{
  const a=draft.approval;
  const kind=draft.action==='scope_change'?'scope_change':draft.action==='client_reminder'?'client_email':'plan_correction';
  if(draft.action==='retry_recovery'&&a.payload.effects.some(e=>e.system!=='soldline'||e.action!=='retry_recovery'||e.records.length!==1||e.records[0].id!==draft.recoveryId))ctx.addIssue({code:'custom',message:copy.params,path:['approval']});
  if(a.payload.effects.some(e=>e.action==='retry_recovery'&&draft.action!=='retry_recovery'||e.action==='accept_scope_change'&&draft.action!=='scope_change'))ctx.addIssue({code:'custom',message:copy.params,path:['approval']});
  if(a.kind!==kind||draft.action==='retry_recovery'&&!draft.recoveryId||a.payload.effects.some(e=>e.system==='mail')&&a.kind!=='client_email'||a.kind==='client_email'&&(a.reversibility!=='irreversible'||a.payload.effects.some(e=>e.system!=='mail'||!e.message)))ctx.addIssue({code:'custom',message:copy.params,path:['approval']});
});
export const messageInput=z.object({message:z.string().trim().min(1).max(2000),threadId:z.uuid().optional(),card:cardDraft.optional(),draft:draftRequest.optional()}).strict().refine(v=>!v.card||!v.draft);
export async function draftAccess(db:SqlConnection,m:Member,draft:z.infer<typeof cardDraft>,guard:typeof assertCan=assertCan) {
  const a=draft.approval;
  const run=(await db.query<{id:string;workspace_id:string}>('SELECT id,workspace_id FROM runs WHERE id=$1',[a.runId])).rows[0];
  if(!run)return false;
  guard(m,'propose_scope_change',{...run,intent:'propose'});
  if(draft.action==='retry_recovery'){
    if(!draft.recoveryId)return false;
    const item=(await db.query<{id:string;workspace_id:string;owner_member_id:string}>("SELECT id,workspace_id,owner_member_id FROM recovery_items WHERE id=$1 AND run_id=$2 AND status='open' AND 'retry_now'=ANY(allowed_options)",[draft.recoveryId,a.runId])).rows[0];
    if(!item)return false;
    guard(m,'resolve_recovery',item);
  }
  const kind=draft.action==='scope_change'?'scope_change':draft.action==='client_reminder'?'client_email':'plan_correction';
  return a.kind===kind;
}
export async function postMessage(db:SqlConnection,m:Member,input:z.infer<typeof messageInput>){
  const c=await memberCopy(db,m);
  if(input.threadId&&!(await db.query('SELECT id FROM agent_threads WHERE id=$1',[input.threadId])).rows[0])return null;
  if(input.draft){const built=await buildDraft(db,m,input.draft);if(!built)return null;input.card=cardDraft.parse(built);}
  if(input.card&&!await draftAccess(db,m,input.card))return null;
  const data=await permittedData(db,m);
  const memories=(await db.query("SELECT text FROM memories WHERE workspace_id=$1 AND status='active' AND deleted_at IS NULL AND ((scope='person' AND member_id=$2) OR (scope='org' AND NOT ('client_reviewer'=ANY(app_roles($1)))))",[m.workspace_id,m.id])).rows;
  const configured=Number(process.env.AGENT_DAILY_AI_CAP??20);
  const cap=Number.isInteger(configured)&&configured>=0?configured:20;
  const wording=await agentWording({question:input.message,data,memories},async()=>!!(await db.query<{ok:boolean}>('SELECT agent_reserve_ai($1) AS ok',[cap])).rows[0].ok);
  // Generated text is never an action, identifier or fact source. Data and links are rendered deterministically.
  const intro=wording&&!/[\u2013\u2014]| - |https?:|\b(approve|execute|ignore)\b/i.test(wording)?wording:c.summary;
  const rows=Object.entries(data).map(([key,items])=>({label:c[key as keyof typeof c]??key,count:items.length,records:items.map(r=>({id:r.id,name:r.name??r.title??r.label??r.kind??r.status,link:r.run_id?'/runs/'+r.run_id:key==='runs'?'/runs/'+r.id:'/inputs'}))}));
  const thread=input.threadId??(await db.query<{id:string}>('INSERT INTO agent_threads(workspace_id,member_id,title) VALUES($1,$2,$3) RETURNING id',[m.workspace_id,m.id,input.message.slice(0,80)])).rows[0].id;
  await db.query("INSERT INTO agent_messages(workspace_id,member_id,thread_id,role,body) VALUES($1,$2,$3,'user',$4),($1,$2,$3,'agent',$5)",[m.workspace_id,m.id,thread,input.message,JSON.stringify({label:c.answered,intro,rows})]);
  const card=input.card?(await db.query('INSERT INTO agent_cards(workspace_id,member_id,thread_id,draft) VALUES($1,$2,$3,$4) RETURNING id,revision,draft',[m.workspace_id,m.id,thread,JSON.stringify(input.card)])).rows[0]:null;
  const name=(await db.query<{agent_name:string}>('SELECT agent_name FROM members WHERE id=$1',[m.id])).rows[0].agent_name;
  const labels={approve_plan_correction:c.planCorrection,retry_recovery:c.retryRecovery,client_reminder:c.clientReminder,scope_change:c.scopeChange};
  return {threadId:thread,agentName:name,label:c.answered,intro,rows,card:card&&input.card?{...card,label:labels[input.card.action],choices:{yes:c.yes,change:c.change}}:null};
}
