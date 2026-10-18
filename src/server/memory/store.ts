import 'server-only';
import { z } from 'zod';
import type { SqlConnection, TransactionDriver } from '../db/withMember';
import type { Member } from '../permissions';
import { append } from '../audit';
const input=z.object({scope:z.enum(['person','org']),kind:z.enum(['preference','client_preference','decision','mapping']),text:z.string().trim().min(1).max(2000).refine(t=>!/[\u2013\u2014-]/.test(t),'Use plain words'),yes:z.literal(true),sourceRunIds:z.array(z.uuid()).default([]),exception:z.boolean().default(false),big:z.boolean().default(false),personal:z.object({preferredName:z.string().trim().min(1).max(80).optional(),language:z.enum(['en','ar']).optional(),digestTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional()}).strict().optional()}).strict();
type Entry=Record<string,unknown>&{id:string;workspace_id:string;scope:'person'|'org';member_id:string|null;text:string;status:string;deleted_at:string|null;revision:number;history:Snapshot[];kind:string};
type Snapshot={text:string;status:string;deleted_at:string|null;personal?:{preferred_name:string|null;language:string|null;digest_time:string}};
export function memoryStore(owner:TransactionDriver) {
  async function actor(db:SqlConnection,member:Member) {
    const value=(await db.query<Member & {preferred_name:string|null;language:'en'|'ar'|null} & Record<string,unknown>>(`SELECT m.*,coalesce(w.is_demo,false) AS is_demo FROM members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=$1 AND m.id=$2 AND m.archived_at IS NULL AND (NOT coalesce(w.is_demo,false) OR w.demo_expires_at>now())`,[member.workspace_id,member.id])).rows[0];
    if(!value) throw new Error('Memory access refused');
    await db.query("SELECT set_config('app.member_id',$1,true)",[value.id]);return value;
  }
  const admin=(m:Member)=>m.roles.includes('admin')&&!m.roles.includes('client_reviewer');
  const permitted=(m:Member,e:Entry)=>e.scope==='person'?e.member_id===m.id:admin(m);
  async function saveSnapshot(db:SqlConnection,e:Entry,m:Member) {
    const personal=e.scope==='person'?(await db.query<{preferred_name:string|null;language:string|null;digest_time:string}>('SELECT preferred_name,language,digest_time FROM members WHERE workspace_id=$1 AND id=$2',[m.workspace_id,m.id])).rows[0]:undefined;
    return [...e.history,{text:e.text,status:e.status,deleted_at:e.deleted_at,personal}];
  }
  return {
    async list(member:Member,includeDeleted=false) {
      return owner.transaction(async db=>{const m=await actor(db,member);return (await db.query<Entry>(`SELECT * FROM memories WHERE workspace_id=$1 AND (($2::boolean AND scope='org') OR (scope='person' AND member_id=$3)) AND ($4::boolean OR deleted_at IS NULL) ORDER BY id`,[m.workspace_id,admin(m),m.id,includeDeleted])).rows;});
    },
    async remember(member:Member,value:z.input<typeof input>) {
      const data=input.parse(value);
      if(data.exception) throw new Error('An exception does not become a memory');
      return owner.transaction(async db=>{
        const m=await actor(db,member);
        if(data.scope==='org'&&(!m.roles.some(r=>['admin','account_manager','delivery_lead'].includes(r))||m.roles.includes('client_reviewer'))) throw new Error('Memory access refused');
        if(data.scope==='org'&&/\b(staff|salary|performance|technician)\b|موظف|راتب|أداء/i.test(data.text)) throw new Error('Personal records need a private manager view');
        if(data.scope==='org'&&data.personal) throw new Error('Personal memory stays personal');
        const sources=[...new Set(data.sourceRunIds)];
        if(data.scope==='org') {
          if(sources.length<2) throw new Error('A lesson needs repeated records');
          const count=(await db.query<{n:number}>('SELECT count(*)::int AS n FROM runs WHERE workspace_id=$1 AND id=ANY($2::uuid[])',[m.workspace_id,sources])).rows[0].n;
          if(count!==sources.length) throw new Error('Memory records must belong to this workspace');
        }
        // Every company lesson waits for admin review so impact is never inferred from free text.
        const status=data.scope==='org'?'waiting_approval':'active';
        const e=(await db.query<Entry>(`INSERT INTO memories(workspace_id,scope,member_id,kind,text,based_on,based_on_count,status,confirmed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[m.workspace_id,data.scope,data.scope==='person'?m.id:null,data.kind,data.text,JSON.stringify(sources),sources.length,status,m.id])).rows[0];
        {
          const previous=data.scope==='person'?(await db.query<{preferred_name:string|null;language:string|null;digest_time:string}>('SELECT preferred_name,language,digest_time FROM members WHERE workspace_id=$1 AND id=$2',[m.workspace_id,m.id])).rows[0]:undefined;
          await db.query('UPDATE memories SET history=$3 WHERE workspace_id=$1 AND id=$2',[m.workspace_id,e.id,JSON.stringify([{text:e.text,status:e.status,deleted_at:new Date().toISOString(),personal:previous}])]);
          if(data.personal) await db.query('UPDATE members SET preferred_name=coalesce($3,preferred_name),language=coalesce($4,language),digest_time=coalesce($5::time,digest_time) WHERE workspace_id=$1 AND id=$2',[m.workspace_id,m.id,data.personal.preferredName??null,data.personal.language??null,data.personal.digestTime??null]);
        }
        await append(db,m.workspace_id,{action:'memory_confirmed',outcome:'succeeded',target_id:e.id,after:{status,count:sources.length}});return e;
      });
    },
    async change(member:Member,id:string,operation:'edit'|'delete'|'undo'|'approve',text?:string) {
      return owner.transaction(async db=>{
        const m=await actor(db,member);
        const e=(await db.query<Entry>('SELECT * FROM memories WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[m.workspace_id,id])).rows[0];
        if(!e||!permitted(m,e)) throw new Error('Memory access refused');
        if(operation==='approve'&&(!admin(m)||e.scope!=='org'||e.status!=='waiting_approval'||e.deleted_at)) throw new Error('Memory approval refused');
        let snapshot:Snapshot={text:e.text,status:e.status,deleted_at:e.deleted_at};
        let history=await saveSnapshot(db,e,m);
        if(operation==='undo') {const previous=e.history.at(-1);if(!previous) {snapshot.deleted_at=new Date().toISOString();history=[];} else {snapshot=previous;history=e.history.slice(0,-1);}}
        else if(operation==='delete') snapshot.deleted_at=new Date().toISOString();
        else if(operation==='approve') snapshot.status='active';
        else {snapshot.text=input.shape.text.parse(text);if(e.scope==='org'&&/\b(staff|salary|performance|technician)\b|موظف|راتب|أداء/i.test(snapshot.text)) throw new Error('Personal records need a private manager view');if(e.scope==='org') snapshot.status='waiting_approval';}
        await db.query('UPDATE memories SET text=$3,status=$4,deleted_at=$5,history=$6,revision=revision+1 WHERE workspace_id=$1 AND id=$2',[m.workspace_id,id,snapshot.text,snapshot.status,snapshot.deleted_at,JSON.stringify(history)]);
        if(operation==='undo'&&e.scope==='person'&&snapshot.personal) await db.query('UPDATE members SET preferred_name=$3,language=$4,digest_time=$5 WHERE workspace_id=$1 AND id=$2',[m.workspace_id,m.id,snapshot.personal.preferred_name,snapshot.personal.language,snapshot.personal.digest_time]);
        await append(db,m.workspace_id,{action:'memory_'+operation,outcome:'succeeded',target_id:id,after:{revision:e.revision+1}});
        return {message:operation==='delete'?'Memory removed':operation==='undo'?'Memory restored':'Memory saved'};
      });
    },
    async context(member:Member) {
      return owner.transaction(async db=>{
        const m=await actor(db,member);
        // Only confirmed company lessons are shared. Personal history is never merged.
        const entries=(await db.query<{id:string;text:string;scope:string;based_on_count:number}>(`SELECT id,text,scope,based_on_count FROM memories WHERE workspace_id=$1 AND status='active' AND confirmed_by IS NOT NULL AND deleted_at IS NULL AND ((scope='person' AND member_id=$2) OR (scope='org' AND $3::boolean)) ORDER BY id`,[m.workspace_id,m.id,!m.roles.includes('client_reviewer')])).rows;
        await append(db,m.workspace_id,{action:'memory_used',outcome:'succeeded',after:{entries:entries.map(e=>e.id)}});
        return {preferredName:m.preferred_name??null,language:m.language??'en',entries,reasons:entries.map(e=>({id:e.id,reason:'Used memory: '+e.text}))};
      });
    },
    async forgetPersonal(member:Member,yes:boolean,includeIdentity=false) {
      if(yes!==true) throw new Error('Confirm before clearing personal memory');
      return owner.transaction(async db=>{
        const m=await actor(db,member);
        const entries=(await db.query<Entry>("SELECT * FROM memories WHERE workspace_id=$1 AND member_id=$2 AND scope='person' AND deleted_at IS NULL FOR UPDATE",[m.workspace_id,m.id])).rows;
        for(const e of entries) {await db.query('UPDATE memories SET deleted_at=now(),history=$3,revision=revision+1 WHERE workspace_id=$1 AND id=$2',[m.workspace_id,e.id,JSON.stringify(await saveSnapshot(db,e,m))]);await append(db,m.workspace_id,{action:'memory_delete',outcome:'succeeded',target_id:e.id});}
        await db.query("UPDATE members SET digest_time='09:00',preferred_name=CASE WHEN $3 THEN NULL ELSE preferred_name END,language=CASE WHEN $3 THEN NULL ELSE language END WHERE workspace_id=$1 AND id=$2",[m.workspace_id,m.id,includeIdentity]);
        return {message:'Personal memory cleared'};
      });
    },
  };
}
