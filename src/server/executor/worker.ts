import 'server-only';
import { z } from 'zod';
import type { Job } from '../jobs/store';
import { Retryable } from '../integrations/errors';
import type { DealWrite } from '../integrations/hubspot';
import type { ExecutorStore } from './store';
import { after, marker, type Effect } from './model';
import type { executorProviders } from './providers';
type Providers=ReturnType<typeof executorProviders>;
const taskInput=z.object({name:z.string().min(1),markdown_content:z.string().optional(),assignees:z.array(z.number().int()).min(1),due_date:z.number().finite(),time_estimate:z.number().optional()}).strict();
const changed='Someone changed this task after it was created. Undo would lose that work.';
class ChangedTask extends Error {}
type MemberName=(workspace:string,external:string)=>Promise<string|null>;
async function taskMatches(client:Providers['clickup'],list:string,ref:string) {
  const matches=[];const seen=new Set<number>();let page=0;
  for(;;) {
    if(seen.has(page) || page>=1000) throw new Error('Task pages need attention');
    seen.add(page);
    const result=await client.getListTasks(list,page);
    matches.push(...result.tasks.filter(t=>[t.markdown_description,t.description].some(text=>typeof text==='string'&&text.split('\n').includes(ref))));
    if(result.last_page===true || (!result.tasks.length && result.last_page!==false)) break;
    page++;
  }
  if(matches.length>1) throw new Error('More than one task has this Soldline reference');
  return matches[0];
}
async function apply(store:ExecutorStore,providers:Providers,e:Effect,runRef:string,reconcileOnly=false,memberName:MemberName=async()=>null):Promise<void> {
  const record=e.request.records[0];const fields=record?after(record):{};
  const uncertain=['unknown','in_flight'].includes(e.state);
  if(e.action==='reverse') {
    if(reconcileOnly) throw new Error('Undo needs an explicit retry');
    const original=await store.get(e.workspace_id,record.id);
    if(!original || original.run_id!==e.run_id || original.reversibility!=='reversible' || !['succeeded','compensated'].includes(original.state)) throw new Error('This work cannot be undone');
    if(original.state==='compensated') {await store.set(e,'succeeded');return;}
    if(original.action==='create_task') {
      const current=await providers.clickup.getTask(original.external_id!);
      if(!original.result?.date_updated || current.date_updated!==original.result.date_updated) {
        const editor=current.last_editor??current.last_updated_by;
        const assignee=Array.isArray(current.assignees)?current.assignees[0]:null;
        const person=editor??assignee;
        const external=typeof person==='object'&&person!==null&&'id' in person?String(person.id):typeof person==='number'||typeof person==='string'?String(person):null;
        const name=external?await memberName(e.workspace_id,external):null;
        throw new ChangedTask(name?`${name} changed this task after it was created. Undo would lose his work.`:changed);
      }
      await store.set(e,'in_flight');
      await providers.clickup.archiveTask(original.external_id!);
    } else if(original.action==='patch_deal_properties') {
      const current=await providers.hubspot.getDeal(original.target_ref);
      const before=original.result?.before as Record<string,string|null>;
      const afterValues=original.result?.after as Record<string,string>;
      if(!before || !afterValues || Object.entries(afterValues).some(([k,v])=>current.properties[k]!==v)) throw new Error('The deal changed after delivery. Undo would lose that work.');
      await store.set(e,'in_flight');
      await providers.hubspot.patchDealProperties(original.target_ref,Object.fromEntries(Object.entries(before).map(([k,v])=>[k,v??''])) as DealWrite,{modifiedAt:current.properties.hs_lastmodifieddate!,properties:afterValues});
    } else if(['create_folder','create_list'].includes(original.action)) {
      const current=original.action==='create_folder'?await providers.clickup.getFolder(original.external_id!):await providers.clickup.getList(original.external_id!);
      if(!original.result?.date_updated || current.date_updated!==original.result.date_updated) throw new Error('This folder or list changed after delivery');
      if(original.action==='create_list') {
        let page=0;
        for(;;) {
          const result=await providers.clickup.getListTasks(original.external_id!,page++);
          if(result.tasks.some(t=>t.archived!==true)) throw new Error('This list still has work. Undo would lose that work.');
          if(result.last_page===true || !result.tasks.length) break;
          if(page>=1000) throw new Error('Task pages need attention');
        }
      } else if((await providers.clickup.listLists(original.external_id!)).lists.some(l=>l.archived!==true)) throw new Error('This folder still has lists. Undo would lose that work.');
      await store.set(e,'in_flight');
      if(original.action==='create_folder') await providers.clickup.archiveFolder(original.external_id!);else await providers.clickup.archiveList(original.external_id!);
    } else {
      // Containers without a confirmed modification and child activity contract cannot be undone safely.
      throw new Error('This folder or list needs a manual check before undo');
    }
    await store.set(original,'compensated');await store.set(e,'succeeded',undefined,original.external_id??undefined);return;
  }
  if(e.system==='clickup' && e.action==='create_task') {
    const ref=marker(runRef,record.id);
    await store.event(e,'task_reconcile_started');
    const existing=await taskMatches(providers.clickup,e.target_ref,ref);
    await store.event(e,'task_reconcile_finished');
    if(existing) {await store.set(e,'succeeded',{date_updated:existing.date_updated,adopted:true},existing.id);return;}
    if(reconcileOnly) throw new Error('No existing task matches this reference');
    const input=taskInput.parse(fields);
    await store.set(e,'in_flight');
    const created=await providers.clickup.createTask(e.target_ref,{...input,markdown_content:(input.markdown_content?input.markdown_content+'\n':'')+ref});
    await store.set(e,'succeeded',{date_updated:created.date_updated},created.id);return;
  }
  if(e.system==='clickup' && ['create_folder','create_list'].includes(e.action)) {
    const name=z.string().min(1).parse(fields.name);
    const objects=e.action==='create_folder'?(await providers.clickup.listFolders(e.target_ref)).folders:(await providers.clickup.listLists(e.target_ref)).lists;
    if(uncertain && e.attempts>0) {
      if(!Array.isArray(e.result?.before_ids)) throw new Error('The earlier create needs a manual check');
      const found=objects.filter(o=>o.name===name && !(e.result!.before_ids as string[]).includes(o.id));
      if(found.length>1) throw new Error('More than one container matches this create');
      if(found[0]) {await store.set(e,'succeeded',{...e.result,date_updated:found[0].date_updated,adopted:true},found[0].id);return;}
    }
    if(reconcileOnly) throw new Error('No existing container matches this create');
    const observed={before_ids:objects.map(o=>o.id)};
    await store.observe(e,observed);await store.set(e,'in_flight');
    const created=e.action==='create_folder'?await providers.clickup.createFolder(e.target_ref,name):await providers.clickup.createList(e.target_ref,name);
    await store.set(e,'succeeded',{...observed,date_updated:created.date_updated},created.id);return;
  }
  if(e.system==='hubspot' && e.action==='patch_deal_properties') {
    const values=z.object({soldline_delivery_status:z.string().optional(),soldline_plan_url:z.string().optional(),soldline_run_ref:z.string().optional()}).strict().parse(fields);
    const current=await providers.hubspot.getDeal(e.target_ref);
    if(uncertain && e.result?.before) {
      if(Object.entries(values).every(([k,v])=>current.properties[k]===v)) {await store.set(e,'succeeded',e.result,e.target_ref);return;}
      const before=e.result.before as Record<string,string|null>;
      if(Object.entries(before).some(([k,v])=>(current.properties[k]??null)!==v)) throw new Error('The deal changed while delivery was uncertain');
    }
    if(reconcileOnly) throw new Error('The deal needs an explicit retry');
    const before=(e.result?.before??Object.fromEntries(Object.keys(values).map(k=>[k,current.properties[k]??null]))) as Record<string,string|null>;
    const observation={before,after:values};
    await store.observe(e,observation);await store.set(e,'in_flight');
    const expected=Object.fromEntries(Object.keys(values).map(k=>[k,current.properties[k]??null]));
    await providers.hubspot.patchDealProperties(e.target_ref,values,{modifiedAt:current.properties.hs_lastmodifieddate!,properties:expected});
    await store.set(e,'succeeded',observation,e.target_ref);return;
  }
  if(e.system==='mail' && e.action==='send_message') {
    const message=e.request.message;
    if(!message) throw new Error('The exact message is missing');
    const messageId=typeof e.result?.message_id==='string'?e.result.message_id:`<soldline.${e.id}@soldline.local>`;
    const since=typeof e.result?.since==='string'?e.result.since:new Date().toISOString();
    const observation={...e.result,message_id:messageId,since};
    if(uncertain) {
      await store.event(e,'mail_reconcile_started');
      const sent=await providers.mail().searchSent({to:message.to.join(','),subject:message.subject,since,messageId});
      const matches=sent.messages.filter(m=>m.message_id===messageId || (m.headers as Record<string,string>|undefined)?.['Message-ID']===messageId);
      if(matches.length===1) {await store.set(e,'succeeded',observation,matches[0].message_id);return;}
      throw new Error('Mail sending is uncertain. Check sent mail before any further decision.');
    }
    await store.observe(e,observation);await store.set(e,'in_flight');
    const draft=await providers.mail().createDraft({to:message.to,subject:message.subject,text:message.body,messageId});
    await store.observe(e,{...observation,draft_id:draft.draft_id});
    const sent=await providers.mail().sendDraft(draft.draft_id);
    await store.set(e,'succeeded',{...observation,draft_id:draft.draft_id,...(sent.sample?{status:sent.status,sample:true}:{})},sent.message_id);return;
  }
  if(e.system==='soldline' && e.action==='retry_recovery'){const result=await store.retryRecovery(e);if(result.status>=400)throw new Error('Retry could not be queued');return;}
  if(e.system==='soldline' && e.action==='accept_scope_change') {await store.scopeChange(e);return;}
  if(e.system==='soldline' && e.action==='create_recovery') {
    const title=z.string().parse(fields.title),member=z.uuid().parse(fields.owner_member_id);
    const id=await store.lineRecovery(e,title,member);await store.set(e,'succeeded',{},id);return;
  }
  throw new Error('This approved action is not supported');
}
export async function executeEffects(store:ExecutorStore,job:Job,providers:Providers,reconcileOnly=false,memberName:MemberName=async()=>null) {
  const data=await store.load(job);if(!data) return;
  for(const root of data.roots) {
    if(['succeeded','compensated'].includes(root.state)) continue;
    if(root.state==='cancelled') throw new Error('Remaining work was cancelled');
    const target=await store.target(root.workspace_id,root.run_id,root.target_ref);
    const records=root.request.records.length?root.request.records:[{id:'message',fields:{}}];
    for(const record of records) {
      if(!await store.active(job)) throw new Error('Run is paused or the execution lease expired');
      const child=await store.child(root,{...root.request,records:root.request.records.length?[record]:[]},record.id,target);
      if(['succeeded','compensated'].includes(child.state)) continue;
      if(child.state==='cancelled') throw new Error('Remaining work was cancelled');
      try {
        if(reconcileOnly && !['unknown','in_flight'].includes(child.state)) throw new Error('This effect needs an explicit retry');
        await apply(store,providers,child,root.run_id,reconcileOnly,memberName);
      } catch(error) {
        const fresh=await store.get(child.workspace_id,child.id);
        const state=fresh?.state==='in_flight'||child.state==='unknown'||child.state==='in_flight'?'unknown':error instanceof Retryable?'unknown':'failed';
        await store.set(child,state);
        const reason=error instanceof ChangedTask || error instanceof Error && error.message==='This folder or list needs a manual check before undo'?error.message:child.system==='mail'?'Mail sending needs a sent mail check':'Delivery could not finish. Retry will first check existing work.';
        await store.recovery(job,child,reason);
        throw error;
      }
    }
    await store.set(root,'succeeded');
  }
  await store.complete(job);
}
