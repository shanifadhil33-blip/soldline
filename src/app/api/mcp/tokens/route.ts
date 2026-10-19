import { randomBytes } from 'node:crypto';
import { withMemberRoute, fail } from '../../../../server/http';
import { z } from 'zod';
import { tokenHash } from '../../../../server/agent-owner';
import { append } from '../../../../server/audit';
import { copy } from '../../../../server/backend-a5';
export const GET=withMemberRoute(async(_r,_c,_m,db)=>Response.json((await db.query('SELECT id,name,created_at,revoked_at FROM mcp_tokens ORDER BY created_at,id')).rows));
export const POST=withMemberRoute(async(r,_c,m,db)=>{
 const data=z.object({name:z.string().trim().min(1).max(80)}).strict().safeParse(await r.json().catch(()=>null));if(!data.success)return fail(400,copy.invalid+': name');
 const secret=randomBytes(32).toString('base64url');
 const token=(await db.query('INSERT INTO mcp_tokens(workspace_id,member_id,name,token_hash) VALUES($1,$2,$3,$4) RETURNING id,name,created_at',[m.workspace_id,m.id,data.data.name,tokenHash(secret)])).rows[0];
 await append(db,m.workspace_id,{action:'mcp_token_created',outcome:'succeeded',target_id:String(token.id)});
 return Response.json({...token,secret},{status:201});
});
