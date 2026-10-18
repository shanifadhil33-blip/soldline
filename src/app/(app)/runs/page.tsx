import { screenData,readRuns } from '../../../server/screens';
import { getLanguage } from '../../../lib/locale';
import { loadMessages } from '../../../lib/i18n';
import { RunList } from '../../../components/run-list';
const sorts=['client','deal','status','won','ready','owner'] as const;
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
  const locale=await getLanguage(),m=loadMessages(locale),query=await searchParams;
  const sort=sorts.find(key=>key===query.sort)??'won',direction=query.direction==='asc'?'asc':'desc';
  const runs=await screenData(readRuns);
  runs.sort((a,b)=>{
    const difference=sort==='won'||sort==='ready'
      ? (a[sort]?new Date(a[sort]).getTime():0)-(b[sort]?new Date(b[sort]).getTime():0)
      : String(a[sort]??'').localeCompare(String(b[sort]??''));
    return difference*(direction==='asc'?1:-1)||a.id.localeCompare(b.id);
  });
  return <section className="screen"><h1>{m.nav.runs}</h1><form className="screen-toolbar"><label>{m.screens.sort}<select name="sort" defaultValue={sort}>{sorts.map((key,i)=><option key={key} value={key}>{m.screens.columns[i]}</option>)}</select></label><label>{m.screens.order}<select name="direction" defaultValue={direction}><option value="asc">{m.screens.ascending}</option><option value="desc">{m.screens.descending}</option></select></label><button className="button">{m.screens.apply}</button></form><RunList runs={runs} locale={locale}/></section>;
}
