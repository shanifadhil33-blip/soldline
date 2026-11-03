import { getMember } from '../../../server/session';
import { getOwnerServices } from '../../../server/db/runtime';
import { demoCached } from '../../../server/demo/read-cache';
export async function GET(request:Request) {
  const member=await getMember(request);if(!member)return Response.json({message:'Please sign in or try the demo.'},{status:401});
  if(!member.is_demo) {
    const {status,...body}=await getOwnerServices().trust.audit(member);
    return Response.json(body,{status});
  }
  const data=await demoCached(member.workspace_id,`${member.id}:GET /api/audit`,async()=>{
    const {status,...body}=await getOwnerServices().trust.audit(member);
    if(status>=400) throw Object.assign(new Error('skip-cache'),{status,body});
    return {status,body};
  }).catch((error:{message?:string;status?:number;body?:unknown})=>{
    if(error?.message==='skip-cache') return {status:error.status??400,body:error.body??{}};
    throw error;
  });
  return Response.json(data.body,{status:data.status});
}
