import { withMemberRoute, fail } from '../../../../server/http';
import { messageInput, postMessage } from '../../../../server/agent';
export const POST=withMemberRoute(async(r,_c,m,db)=>{
 const data=messageInput.safeParse(await r.json().catch(()=>null));
 if(!data.success){
  const field=data.error.issues[0]?.path[0];
  return fail(400,field==='threadId'?'Choose a valid thread.':field==='card'||field==='draft'?'Send either a card or a draft request, with valid details.':'Write a message of 1 to 2000 characters.');
 }
 const result=await postMessage(db,m,data.data);return result?Response.json(result):fail(404);
});
