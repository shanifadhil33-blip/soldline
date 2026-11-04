import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getMember } from '../../../../server/session';
import { getOwnerServices } from '../../../../server/db/runtime';
import { DeliverableDetail } from '../../../../components/deliverable-detail';
import { ProjectGone } from '../../../../components/project-gone';
import { getLanguage } from '../../../../lib/locale';
export default async function Page({params}:{params:Promise<{id:string}>}) {
  const member=await getMember(await cookies());if(!member)notFound();
  const {id}=await params;
  const locale=await getLanguage();
  const data=await getOwnerServices().trust.deliverable(member,id);
  if(!data)return <ProjectGone locale={locale}/>;
  return <DeliverableDetail data={data} locale={locale}/>;
}
