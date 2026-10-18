import { notFound } from 'next/navigation';
import { getLanguage } from '../../../../lib/locale';
import { screenData } from '../../../../server/screens';
import { RunDetail } from '../../../../components/run-detail';
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{tab?:string}>}) {
  const {id}=await params;
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) notFound();
  const exists=await screenData(async db=>(await db.query('SELECT id FROM runs WHERE id=$1',[id])).rows.length>0);
  if(!exists) notFound();
  const {tab}=await searchParams;
  const initialTab=tab==='inputs'||tab==='findings'||tab==='clickup'||tab==='emails'||tab==='history'?tab:'plan';
  return <RunDetail id={id} locale={await getLanguage()} initialTab={initialTab}/>;
}
