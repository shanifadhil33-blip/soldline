import { withMemberRoute, fail } from '../../../../server/http';
import { settings, companySettings, copy, invalidField } from '../../../../server/backend-a5';
import { assertCan } from '../../../../server/permissions';
export const GET=withMemberRoute(async(_r,_c,m,db)=>Response.json(await settings(db,m,true)));
export const PATCH=withMemberRoute(async(r,_c,m,db)=>{
  assertCan(m,'manage_connections_roles',{workspace_id:m.workspace_id});
  const parsed=companySettings.safeParse(await r.json().catch(()=>null));
  if(!parsed.success)return fail(400,invalidField(parsed.error,'settings'));
  const result=await settings(db,m,true,parsed.data);
  return result?Response.json(result):fail(400,copy.invalid+': defaultDeliveryLead');
});
