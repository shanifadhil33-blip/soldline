import { withMemberRoute, fail, answer } from '../../../../../server/http';
import { z } from 'zod';
import { append } from '../../../../../server/audit';
import { copy } from '../../../../../server/backend-a5';
export const DELETE=withMemberRoute(async(_r,c,m,db)=>{
 const {id}=await c.params;if(!z.uuid().safeParse(id).success)return fail(404);
 const result=await db.query('UPDATE mcp_tokens SET revoked_at=now() WHERE id=$1 RETURNING id',[id]);if(!result.rows[0])return fail(404);
 await append(db,m.workspace_id,{action:'mcp_token_revoked',outcome:'succeeded',target_id:id});return answer(200,copy.saved);
});
