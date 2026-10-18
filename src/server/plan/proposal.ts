import { createHash } from 'node:crypto';
import type { Item } from '../scope/parser';
import { noOwner, normalise, type Mapping } from '../scope/rules';
export function canonical(value:unknown):string {
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if(value && typeof value==='object') return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value);
}
export const hash = (value:unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export type Candidate = {id:string;roles:string[];openTasks:number};
export function dueDate(start:string, offset:number, timezone:string) {
  const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(start)?start:new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(start));
  const date=new Date(dateOnly+'T12:00:00Z');
  if(!Number.isFinite(date.getTime()) || !Number.isInteger(offset)) throw new Error('Contract date needs attention');
  date.setUTCDate(date.getUTCDate()+offset);
  return date.toISOString().slice(0,10);
}
export function propose(items:Item[], mappings:Mapping[], members:Candidate[], start:string, timezone:string) {
  const counts=new Map(members.map(m=>[m.id,m.openTasks]));
  const tasks=items.map((item,index)=>{
    const m=mappings.find(m=>[m.title,...m.synonyms].some(t=>normalise(t)===normalise(item.title)));
    const owner=m?members.filter(c=>c.roles.includes(m.role)).sort((a,b)=>(counts.get(a.id)!-counts.get(b.id)!)||a.id.localeCompare(b.id))[0]:undefined;
    if(owner) counts.set(owner.id,counts.get(owner.id)!+1);
    return {scopeItem:index+1,title:m?.taskTitle??item.title,list:m?.list??null,role:m?.role??null,estimateMinutes:m?.estimate??null,owner:owner?.id??null,due:dueDate(start,m?.offset??0,timezone),quantity:item.quantity,cadence:item.cadence};
  });
  return {tasks,plan_hash:hash(tasks),findings:tasks.flatMap(t=>noOwner(t.title,t.owner))};
}
