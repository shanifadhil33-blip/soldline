import { cookies } from 'next/headers';
import { getMember } from '../../../server/session';
import { AuditScreen } from '../../../components/trust-screens';
import { getLanguage } from '../../../lib/locale';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string>>}) {const member=await getMember(await cookies());const refusedOnServer=!member?.roles.some(role=>['admin','account_manager','delivery_lead'].includes(role));return <AuditScreen refusedOnServer={refusedOnServer} locale={await getLanguage()} initialFilters={await searchParams}/>;}
