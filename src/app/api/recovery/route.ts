import { withMemberRoute } from '../../../server/http';
export const GET=withMemberRoute(async(_request,_context,member,db)=>{
  const rows=(await db.query(`SELECT i.id,i.run_id,i.title,i.plain_reason,i.status,i.allowed_options,EXISTS(SELECT 1 FROM external_effects e WHERE e.workspace_id=i.workspace_id AND e.run_id=i.run_id AND e.parent_effect_id IS NOT NULL AND e.state='succeeded' AND e.reversibility='reversible' AND e.action IN ('create_task','patch_deal_properties','create_list','create_folder')) AND $4::boolean AS reversible FROM recovery_items i WHERE i.workspace_id=$1 AND i.status='open' AND ($2 OR i.owner_member_id=$3) ORDER BY i.created_at,i.id`,[member.workspace_id,member.roles.includes('admin'),member.id,member.roles.includes('admin')||member.roles.includes('delivery_lead')])).rows;
  return Response.json({rows});
});
