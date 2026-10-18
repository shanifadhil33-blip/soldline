import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getMember } from './session';
import { getAppDriver } from './db/runtime';
import { withMember, type SqlConnection } from './db/withMember';
import type { Member } from './permissions';
export type RunRow = {id:string;client:string;deal:string;status:string;won:string|null;ready:string|null;owner:string|null;is_demo:boolean};
export async function screenData<T>(read:(db:SqlConnection,member:Member)=>Promise<T>) {
  const member=await getMember(await cookies());
  if(!member) redirect('/sign-in');
  if(member.roles.includes('client_reviewer')) redirect('/home');
  return withMember(getAppDriver(),member.id,db=>read(db,member));
}
export async function readRuns(db:SqlConnection):Promise<RunRow[]> {
  return (await db.query<RunRow>(`SELECT r.id,w.is_demo,c.name AS client,d.name AS deal,r.status,r.won_at AS won,r.ready_at AS ready,m.display_name AS owner FROM runs r JOIN workspaces w ON w.id=r.workspace_id JOIN deals d ON d.id=r.deal_id AND d.workspace_id=r.workspace_id JOIN client_companies c ON c.id=d.client_company_id AND c.workspace_id=d.workspace_id LEFT JOIN members m ON m.id=r.delivery_lead_id AND m.workspace_id=r.workspace_id ORDER BY r.created_at DESC,r.id`)).rows;
}
