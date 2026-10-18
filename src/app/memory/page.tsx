import { cookies } from 'next/headers';
import { getMember } from '../../server/session';
import { getOwnerServices } from '../../server/db/runtime';
import MemoryEntries from './entries';
export default async function MemoryPage() {
  const member=await getMember(await cookies());
  if(!member) return <main><h1>Memory</h1><p>Please sign in or try the demo.</p></main>;
  const entries=await getOwnerServices().memory.list(member,true);
  const context=await getOwnerServices().memory.context(member);
  return <main lang={context.language} dir={context.language==='ar'?'rtl':'ltr'}><MemoryEntries language={context.language} name={context.preferredName} entries={entries.map(e=>({id:e.id,text:e.text,scope:e.scope,status:e.status,count:Number(e.based_on_count??0),deleted:!!e.deleted_at}))}/></main>;
}
