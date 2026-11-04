import 'server-only';
import { redirect } from 'next/navigation';
import { getMemberFromCookies } from './session';
import { getAppDriver } from './db/runtime';
import { withMember, type SqlConnection } from './db/withMember';
import { demoCached } from './demo/read-cache';
import type { Member } from './permissions';
export type RunRow = {id:string;client:string;deal:string;status:string;won:string|null;ready:string|null;owner:string|null;is_demo:boolean};
export async function screenData<T>(read:(db:SqlConnection,member:Member)=>Promise<T>, label?: string) {
  const member=await getMemberFromCookies();
  if(!member) redirect('/sign-in');
  if(member.roles.includes('client_reviewer')) redirect('/home');
  const load=()=>withMember(getAppDriver(),member.id,db=>read(db,member));
  if(member.is_demo && label) return demoCached(member.workspace_id, `${member.id}:${label}`, load);
  return load();
}
export async function readRuns(db:SqlConnection):Promise<RunRow[]> {
  return (await db.query<RunRow>(`SELECT r.id,w.is_demo,c.name AS client,d.name AS deal,r.status,r.won_at AS won,r.ready_at AS ready,m.display_name AS owner FROM runs r JOIN workspaces w ON w.id=r.workspace_id JOIN deals d ON d.id=r.deal_id AND d.workspace_id=r.workspace_id JOIN client_companies c ON c.id=d.client_company_id AND c.workspace_id=d.workspace_id LEFT JOIN members m ON m.id=r.delivery_lead_id AND m.workspace_id=r.workspace_id ORDER BY r.created_at DESC,r.id`)).rows;
}
export type TeamRow = { name: string; roles: string[]; company: string | null };
export async function readTeam(db: SqlConnection): Promise<TeamRow[]> {
  return (await db.query<TeamRow>(`SELECT m.display_name AS name, m.roles, c.name AS company FROM members m LEFT JOIN client_companies c ON c.id=m.client_company_id AND c.workspace_id=m.workspace_id WHERE m.archived_at IS NULL ORDER BY (m.client_company_id IS NOT NULL), m.display_name`)).rows;
}
