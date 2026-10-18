import 'server-only';
import type { Job, JobStore } from './store';
import type { systemProviders } from './providers';
import type { HubspotEvent } from '../events/model';
export type Providers = ReturnType<typeof systemProviders>;
export async function perform(store: JobStore, providers: Providers, job: Job, now = Date.now, deadline=Date.now()+25000) {
  if(job.kind==='execute_approval_effect') { await store.executeEffect(job,deadline); return; }
  if(job.kind==='process_event') { await store.handleEvent(job.workspace_id,job.payload.eventId); return; }
  if(job.kind==='analyse_deal') {
    if(!await store.hasDeal(job.workspace_id,job.payload.dealId)) await store.importDeal(job.workspace_id,await providers.hubspot(job.workspace_id,deadline).getDeal(job.payload.dealId));
    await store.analyse(job); return;
  }
  const connection=await store.connection(job.workspace_id,job.payload.connectionId);
  if(!connection) throw new Error('Connection needs attention');
  if(job.kind==='mail_poll') {
    const cursor=connection.poll_cursor ?? new Date(0).toISOString();
    const page=await providers.mail(job.workspace_id,connection.external_account_id,deadline).listMessagesSince(cursor);
    // The fixture contract uses the next page token as the next cursor, otherwise the request start time.
    const timestamps=page.messages.map(m=>Date.parse(m.timestamp ?? '')).filter(Number.isFinite);
    const next=page.next_page_token ?? (timestamps.length?new Date(Math.max(...timestamps)).toISOString():cursor);
    await store.saveMail(connection,page.messages,next);
    return;
  }
  const client=providers.hubspot(job.workspace_id,deadline);
  const since=connection.poll_cursor ?? '0';
  const started=String(now());
  if(job.kind==='hubspot_keep_alive') { await client.searchDealsModifiedSince(started); return; }
  if(job.kind!=='reconcile_hubspot') throw new Error('Unknown job');
  const events: HubspotEvent[]=[];
  let after: string|undefined;
  const seen=new Set<string>();
  do {
    const page=await client.searchDealsModifiedSince(since,after);
    for(const deal of page.results) {
      const modified=deal.properties.hs_lastmodifieddate;
      if(!modified) throw new Error('Deal modified time is missing');
      events.push({portalId:connection.external_account_id,eventId:`reconcile:${deal.id}:${modified}`,objectId:deal.id,subscriptionType:'deal.propertyChange',propertyName:'dealstage',propertyValue:deal.properties.dealstage ?? ''});
    }
    after=page.paging?.next.after;
    if(after && seen.has(after)) throw new Error('Provider repeated a page');
    if(after) seen.add(after);
  } while(after);
  await store.saveReconcile(connection,events,started);
}
export async function work(store: JobStore, providers: Providers, now = Date.now) {
  const start=now(); let processed=0;
  while(processed<20 && now()-start<25000) {
    const job=await store.claim(now());
    if(!job) break;
    try { if(job.exhausted) await store.finish(job,false,now()); else { await perform(store,providers,job,now,start+25000); await store.finish(job,true,now()); } }
    catch { await store.finish(job,false,now()); }
    processed++;
  }
  return processed;
}
