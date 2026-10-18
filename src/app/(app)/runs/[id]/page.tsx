import { notFound } from 'next/navigation';
import { getLanguage } from '../../../../lib/locale';
import { cookies } from 'next/headers';
import { getMember } from '../../../../server/session';
import { getAppDriver } from '../../../../server/db/runtime';
import { withMember } from '../../../../server/db/withMember';
import { ClientScreen } from '../../../../components/trust-screens';
import { RunDetail } from '../../../../components/run-detail';
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{tab?:string}>}) {
  const {id}=await params;
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) notFound();
  const member=await getMember(await cookies());
  if(!member) notFound();
  const company=member.roles.includes('client_reviewer')?member.client_company_id:null;
  if(member.roles.includes('client_reviewer')&&!company)notFound();
  const exists=await withMember(getAppDriver(),member.id,async db=>(await db.query('SELECT r.id FROM runs r JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id WHERE r.id=$1 AND ($2::uuid IS NULL OR d.client_company_id=$2)',[id,company])).rows.length>0);
  if(!exists) notFound();
  if(member.roles.includes('client_reviewer'))return <ClientScreen locale={await getLanguage()}/>;
  const {tab}=await searchParams;
  const initialTab=tab==='inputs'||tab==='findings'||tab==='clickup'||tab==='emails'||tab==='history'?tab:'plan';
  return <RunDetail id={id} locale={await getLanguage()} initialTab={initialTab}/>;
}
