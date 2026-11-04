import { redirect } from 'next/navigation';
import { staffOnly } from '../../../server/screens';
import { cookies } from 'next/headers';
import { getMember } from '../../../server/session';
import { AuditScreen } from '../../../components/trust-screens';
import { getLanguage } from '../../../lib/locale';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string>>}) {
  await staffOnly();const member=await getMember(await cookies());if(member?.roles.length===1&&member.roles[0]==='contributor')redirect('/today');const refusedOnServer=!member?.roles.some(role=>['admin','account_manager','delivery_lead'].includes(role));return <AuditScreen refusedOnServer={refusedOnServer} locale={await getLanguage()} initialFilters={await searchParams}/>;}
