import { withMemberRoute } from '../../../../server/http';
export const GET=withMemberRoute(async(_r,_c,_m,db)=>Response.json((await db.query('SELECT id,title,created_at FROM agent_threads ORDER BY created_at DESC,id')).rows));
