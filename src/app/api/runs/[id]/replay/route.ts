import { withMemberRoute } from '../../../../../server/http';
import { getOwnerServices } from '../../../../../server/db/runtime';
export const POST=withMemberRoute(async (_request,context,member)=>{
  const {id}=await context.params;
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) return Response.json({message:'Run not found'},{status:404});
  const {status,...result}=await getOwnerServices().jobs.replay(member,id);
  return Response.json(result,{status});
});
