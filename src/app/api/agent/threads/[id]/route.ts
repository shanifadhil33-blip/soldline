import { withMemberRoute, fail } from '../../../../../server/http';
import { z } from 'zod';
export const GET=withMemberRoute(async(_r,c,_m,db)=>{
 const {id}=await c.params;if(!z.uuid().safeParse(id).success)return fail(404);
 const thread=(await db.query('SELECT id,title,created_at FROM agent_threads WHERE id=$1',[id])).rows[0];
 if(!thread)return fail(404);
 return Response.json({...thread,messages:(await db.query('SELECT id,role,body,created_at FROM agent_messages WHERE thread_id=$1 ORDER BY created_at,id',[id])).rows,cards:(await db.query('SELECT id,draft,note,revision,approval_id FROM agent_cards WHERE thread_id=$1',[id])).rows});
});
