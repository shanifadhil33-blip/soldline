import { hash, type Payload } from '../approvals/model';
export type ExactEffect=Payload['effects'][number];
export type Effect=Record<string,unknown>&{id:string;workspace_id:string;run_id:string;approval_id:string;parent_effect_id:string|null;system:string;action:string;target_ref:string;request:ExactEffect;request_hash:string;state:string;external_id:string|null;attempts:number;result:Record<string,unknown>|null;reversibility:string};
export const effectKey=(runId:string,step:string,targetRef:string,itemKey:string)=>hash([runId,step,targetRef,itemKey]);
export const marker=(runRef:string,itemKey:string)=>`Soldline ref: SL ${runRef} ${itemKey}`;
export function after(record:ExactEffect['records'][number]) {return Object.fromEntries(Object.entries(record.fields).map(([key,value])=>[key,value.after]));}
