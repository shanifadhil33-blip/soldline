import 'server-only';
import { z } from 'zod';
import type { SqlConnection } from './db/withMember';
import { assertCan, type Member } from './permissions';
import { hash, createSchema, type Approval } from './approvals/model';
import { memberCopy } from './backend-a5';
const item=z.object({key:z.string().min(1),title:z.string().min(1),quantity:z.number().positive(),cadence:z.enum(['once','monthly','weekly']),source_page:z.number().int().positive(),source_quote:z.string().min(1)}).strict();
export const draftRequest=z.object({action:z.enum(['approve_plan_correction','retry_recovery','client_reminder','scope_change']),runId:z.uuid(),recoveryId:z.uuid().optional(),to:z.array(z.email()).min(1).optional(),body:z.string().trim().min(1).max(2000).optional(),items:z.array(item).min(1).optional(),reason:z.string().trim().min(1).max(2000).optional()}).strict();
/** Actions originate only in an explicit member request. Record text cannot select an action. */
export async function buildDraft(db:SqlConnection,m:Member,request:z.infer<typeof draftRequest>){
 const run=(await db.query<{id:string;deal_id:string}>('SELECT id,deal_id FROM runs WHERE id=$1',[request.runId])).rows[0];
 if(!run)return null;
 assertCan(m,'propose_scope_change',{workspace_id:m.workspace_id,id:run.id,intent:'propose'});
 const c=await memberCopy(db,m);
 if(request.action==='approve_plan_correction'){
   const source=(await db.query<Approval>(`SELECT * FROM approvals WHERE workspace_id=$1 AND run_id=$2 AND kind IN ('plan_correction','provision') AND payload IS NOT NULL AND input_refs IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(payload->'effects','[]'::jsonb)) e WHERE e->>'action'='retry_recovery') ORDER BY expires_at DESC NULLS LAST,id DESC LIMIT 1`,[m.workspace_id,run.id])).rows[0];
   if(!source)return null;
   const approval=createSchema.safeParse({runId:run.id,kind:'plan_correction',payload:source.payload,inputRefs:source.input_refs,reversibility:source.reversibility});
   return approval.success?{action:request.action,approval:approval.data,...(request.recoveryId?{recoveryId:request.recoveryId}:{})}:null;
 }
 const scope=(await db.query<{id:string;version:number;items_hash:string|null;status:string}>('SELECT id,version,items_hash,status FROM scope_versions WHERE workspace_id=$1 AND deal_id=$2 ORDER BY version DESC LIMIT 1',[m.workspace_id,run.deal_id])).rows[0];
 const inputRefs=[{system:'scope' as const,record_id:run.deal_id,version_marker:scope?String(scope.version):'missing',hash:hash(scope??null)}];
 if(request.action==='retry_recovery'){
   if(!request.recoveryId)return null;
   return {action:request.action,recoveryId:request.recoveryId,approval:{runId:run.id,kind:'plan_correction' as const,inputRefs,reversibility:'cancellable' as const,payload:{effects:[{system:'soldline' as const,location:run.id,action:'retry_recovery',records:[{id:request.recoveryId,fields:{}}],amounts:{}}]}}};
 }
 if(!scope)return null;
 if(request.action==='client_reminder'){
   if(!request.to)return null;
   const inputs=(await db.query<{label:string}>("SELECT label FROM onboarding_inputs WHERE run_id=$1 AND status='missing' ORDER BY id",[run.id])).rows;
   const body=request.body??c.reminderBody+' '+inputs.map(i=>i.label).filter(Boolean).join(', ')+'. '+c.sample;
   return {action:request.action,approval:{runId:run.id,kind:'client_email' as const,inputRefs,reversibility:'irreversible' as const,payload:{effects:[{system:'mail' as const,location:c.sampleInbox,action:'send_message',records:[],amounts:{},message:{to:request.to,subject:c.clientReminder,body}}]}}};
 }
 if(!request.items||!request.reason)return null;
 return {action:request.action,approval:{runId:run.id,kind:'scope_change' as const,inputRefs,reversibility:'cancellable' as const,payload:{effects:[{system:'soldline' as const,location:run.deal_id,action:'accept_scope_change',records:[{id:'scope',fields:{items:{before:null,after:request.items},reason:{before:null,after:request.reason}}}],amounts:{}}]}}};
}
