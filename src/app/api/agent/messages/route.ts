import { withMemberRoute, fail } from '../../../../server/http';
import { messageInput, postMessage } from '../../../../server/agent';
export const POST=withMemberRoute(async(r,_c,m,db)=>{
 const data=messageInput.safeParse(await r.json().catch(()=>null));
 if(!data.success)return fail(400);
 const result=await postMessage(db,m,data.data);return result?Response.json(result):fail(404);
});
