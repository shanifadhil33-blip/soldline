import { getMember } from '../../../server/session';
import { getOwnerServices } from '../../../server/db/runtime';
export async function GET(request:Request) {
  const member=await getMember(request);if(!member)return Response.json({message:'Please sign in or try the demo.'},{status:401});
  const {status,...body}=await getOwnerServices().trust.audit(member);
  return Response.json(body,{status});
}
