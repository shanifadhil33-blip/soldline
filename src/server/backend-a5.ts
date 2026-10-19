import 'server-only';
import { z } from 'zod';
import { loadMessages } from '../lib/i18n';
import { append } from './audit';
import { assertCan, type Member } from './permissions';
import type { SqlConnection } from './db/withMember';
import { clientRecords } from './trust';
export const copy = loadMessages('en').backendA5;
export async function memberCopy(db:SqlConnection, member:Member) {
  const row=(await db.query<{language:string}>('SELECT language FROM members WHERE id=$1',[member.id])).rows[0];
  return loadMessages(row?.language==='ar'?'ar':'en').backendA5;
}
export function invalidField(error:z.ZodError,fallback:string) {
  const issue=error.issues[0];return copy.invalid+': '+(issue?.path.join('.')||(issue?.code==='unrecognized_keys'?issue.keys.join(', '):fallback));
}
export const personalSettings=z.object({preferredName:z.string().trim().min(1).max(80),language:z.enum(['en','ar']),digestTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),agentName:z.string().trim().min(1).max(80),voice:z.boolean()}).partial().strict();
export const companySettings=z.object({agencyName:z.string().trim().min(1).max(160),timeZone:z.string().refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}}),defaultDeliveryLead:z.uuid().nullable(),wonStageId:z.string().trim().min(1).max(160),workingDays:z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(v=>new Set(v).size===v.length)}).partial().strict();
export async function settings(db:SqlConnection,m:Member,company:boolean,patch?:Record<string,unknown>) {
  if(company)assertCan(m,'manage_connections_roles',{workspace_id:m.workspace_id});
  const fields:Record<string,string>=company?{agencyName:'name',timeZone:'timezone',defaultDeliveryLead:'default_delivery_lead_id',wonStageId:'won_stage_id',workingDays:'working_days'}:{preferredName:'preferred_name',language:'language',digestTime:'digest_time',agentName:'agent_name',voice:'voice'};
  if(patch&&Object.keys(patch).length){
    if(company&&patch.defaultDeliveryLead){
      const lead=(await db.query("SELECT id FROM members WHERE workspace_id=$1 AND id=$2 AND 'delivery_lead'=ANY(roles) AND archived_at IS NULL",[m.workspace_id,patch.defaultDeliveryLead])).rows[0];
      if(!lead)return null;
    }
    const entries=Object.entries(patch);
    await db.query(`UPDATE ${company?'workspaces':'members'} SET ${entries.map(([k],i)=>fields[k]+'=$'+(i+2)).join(',')} WHERE id=$1`,[company?m.workspace_id:m.id,...entries.map(([,v])=>v)]);
    await append(db,m.workspace_id,{action:company?'company_settings_updated':'settings_updated',outcome:'succeeded',after:{fields:Object.keys(patch)}});
  }
  return (await db.query(`SELECT ${Object.entries(fields).map(([k,v])=>v+' AS "'+k+'"').join(',')} FROM ${company?'workspaces':'members'} WHERE id=$1`,[company?m.workspace_id:m.id])).rows[0];
}
export async function permittedData(db:SqlConnection,m:Member):Promise<Record<string,Record<string,unknown>[]>> {
  assertCan(m,'see_runs',{workspace_id:m.workspace_id,client_company_id:m.client_company_id,task_member_ids:[m.id]});
  if(m.roles.includes('client_reviewer')){const data=await clientRecords(db,m);return {inputs:data.inputs,tasks:data.deliverables};}
  const runs=(await db.query<{id:string;name:string;status:string;workspace_id:string}>(`SELECT r.id,r.workspace_id,d.name,r.status FROM runs r JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id WHERE r.workspace_id=$1 ORDER BY r.id`,[m.workspace_id])).rows;
  const ids=runs.map(r=>r.id);
  const result:Record<string,Record<string,unknown>[]>={runs};
  for(const [key,table,columns] of [['findings','findings','id,run_id,title,status'],['approvals','approvals','id,run_id,kind,status'],['recovery','recovery_items','id,run_id,kind,status'],['inputs','onboarding_inputs','id,run_id,label,status'],['tasks','monitor_tasks','task_id AS id,run_id,status']] as const){
    result[key]=(await db.query(`SELECT ${columns} FROM ${table} WHERE workspace_id=$1 AND run_id=ANY($2::uuid[]) ORDER BY run_id`,[m.workspace_id,ids])).rows;
  }
  return result;
}
export function pictureType(bytes:Uint8Array) {
  if(bytes.length>=8&&Buffer.from(bytes.subarray(0,8)).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(bytes.length>=12&&Buffer.from(bytes.subarray(0,4)).toString()==='RIFF'&&Buffer.from(bytes.subarray(8,12)).toString()==='WEBP')return 'image/webp';
  return null;
}
