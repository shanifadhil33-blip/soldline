import { withMemberRoute, fail } from '../../../server/http';
import { settings, personalSettings, copy, invalidField } from '../../../server/backend-a5';
export const GET=withMemberRoute(async(_r,_c,m,db)=>Response.json(await settings(db,m,false)));
export const PATCH=withMemberRoute(async(r,_c,m,db)=>{
  
  const parsed=personalSettings.safeParse(await r.json().catch(()=>null));
  if(!parsed.success)return fail(400,invalidField(parsed.error,'settings'));
  const result=await settings(db,m,false,parsed.data);
  return result?Response.json(result):fail(400,copy.invalid+': defaultDeliveryLead');
});
