import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Action, Role } from '../permissions';
export const kinds = ['plan_correction','provision','client_email','scope_change','reversal'] as const;
export type Kind = typeof kinds[number];
export const refSchema = z.object({ system: z.enum(['hubspot','hubspot_line_item','scope','clickup']), record_id: z.string().min(1), version_marker: z.string().min(1), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type InputRef = z.infer<typeof refSchema>;
const effect = z.object({ system: z.enum(['hubspot','clickup','mail','soldline']), location: z.string().min(1), action: z.string().min(1), records: z.array(z.object({ id:z.string().min(1), fields:z.record(z.string(),z.object({before:z.json(),after:z.json()}).strict()) }).strict()), amounts:z.record(z.string(),z.number()), message:z.object({to:z.array(z.email()).min(1),subject:z.string().min(1),body:z.string().min(1)}).strict().optional() }).strict();
export const payloadSchema = z.object({ effects:z.array(effect).min(1) }).strict();
export type Payload = z.infer<typeof payloadSchema>;
export const createSchema = z.object({runId:z.uuid(),kind:z.enum(kinds),payload:payloadSchema,inputRefs:z.array(refSchema).min(1),reversibility:z.enum(['reversible','cancellable','irreversible']),requestedByType:z.enum(['user','agent']).default('user'),requestedByMemberId:z.uuid().nullable().optional()}).strict();
export type CreateApproval = z.input<typeof createSchema>;
export const actions:Record<Kind,Action> = {plan_correction:'approve_plan',provision:'approve_plan',client_email:'approve_client_email',scope_change:'accept_scope_change',reversal:'reverse_effect'};
export const requiredRoles:Record<Kind,Role[]> = {plan_correction:['delivery_lead','admin'],provision:['delivery_lead','admin'],client_email:['account_manager','admin'],scope_change:['account_manager','delivery_lead','admin'],reversal:['delivery_lead','admin']};
export function canonical(value:unknown):string {
  if(value===null || typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';
}
export function hash(value:unknown) {return createHash('sha256').update(canonical(value)).digest('hex');}
export function sortedRefs(refs:InputRef[]) {return [...refs].sort((a,b)=>canonical(a)<canonical(b)?-1:canonical(a)>canonical(b)?1:0);}
export type Approval = Record<string,unknown> & {id:string;workspace_id:string;run_id:string;kind:Kind;requested_by_type:'user'|'agent';requested_by_member_id:string|null;status:string;payload:Payload;payload_hash:string;input_refs:InputRef[];input_hash:string;reversibility:CreateApproval['reversibility'];expires_at:string;decided_by:string|null;decided_at:string|null;confirmed_by:string|null;confirmed_at:string|null;decisions:{member_id:string;decision:string;note:string}[];execution_summary:unknown};
export type Result = {status:number;message:string;approval?:Approval;summary?:unknown};
