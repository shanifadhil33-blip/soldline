import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getMember } from '../../../../server/session';
import { getAppDriver } from '../../../../server/db/runtime';
import { withMember } from '../../../../server/db/withMember';
import { ClientScreen } from '../../../../components/trust-screens';
import { getLanguage } from '../../../../lib/locale';
export default async function Page({params}:{params:Promise<{id:string}>}) {
  const member=await getMember(await cookies());if(!member)notFound();
  const {id}=await params;
  const company=member.roles.includes('client_reviewer')?member.client_company_id:null;
  if(member.roles.includes('client_reviewer')&&!company)notFound();
  const exists=await withMember(getAppDriver(),member.id,async db=>(await db.query('SELECT t.task_id FROM monitor_tasks t JOIN runs r ON r.workspace_id=t.workspace_id AND r.id=t.run_id JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id WHERE t.task_id=$1 AND ($2::uuid IS NULL OR d.client_company_id=$2)',[id,company])).rows.length>0);
  if(!exists)notFound();
  return <ClientScreen locale={await getLanguage()}/>;
}
