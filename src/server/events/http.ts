import 'server-only';
import { z } from 'zod';
import { after } from 'next/server';
import { getOwnerServices } from '../db/runtime';
import { runWorker } from '../jobs/runtime';
import { decryptToken } from '../crypto';
import { hubspotEvent, clickupEvent } from './model';
import { verifyHubspot, verifyClickup, equalSecret } from './signatures';
import type { JobStore } from '../jobs/store';
export type SystemHandler = (request: Request)=>Promise<Response>;
/** System routes authenticate inside their fixed handlers before any mutation. */
export function withSystemRoute(kind: 'hubspot' | 'clickup' | 'tick' | 'daily'): SystemHandler {
  return async request=>{
    if(kind==='tick' || kind==='daily') {
      const secret=(kind==='tick'?process.env.TICK_SECRET:process.env.CRON_SECRET) ?? '';
      if(!secret || !equalSecret(request.headers.get('Authorization') ?? '',`Bearer ${secret}`)) return Response.json({message:'Access refused'},{status:401});
      return tickHandler(getOwnerServices().jobs,runWorker,secret,kind==='daily')(request);
    }
    return webhookHandlers(getOwnerServices().jobs,()=>after(async()=>{await runWorker();}),process.env.HUBSPOT_APP_CLIENT_SECRET ?? '')[kind](request);
  };
}
export function webhookHandlers(store: JobStore, kick: ()=>void, secret: string, key?: string) {
  return {
    async hubspot(request: Request) {
      const raw=await request.text();
      if(!verifyHubspot(request,raw,secret)) return Response.json({message:'Signature refused'},{status:401});
      // JSON parsing and all persistence are strictly after signature verification.
      let events: z.infer<typeof hubspotEvent>[];
      try { events=z.array(hubspotEvent).max(1000).parse(JSON.parse(raw)); }
      catch { return Response.json({message:'Event body is invalid'},{status:400}); }
      const groups=new Map<string,typeof events>();
      for(const event of events) groups.set(event.portalId,[...(groups.get(event.portalId) ?? []),event]);
      for(const [portal,batch] of groups) for(const connection of await store.hubspotConnections(portal)) await store.ingestHubspot(connection,batch,'webhook');
      kick();
      return Response.json({ok:true});
    },
    async clickup(request: Request) {
      const raw=await request.text();
      const signature=request.headers.get('X-Signature') ?? '';
      // Identify the matching secret by MAC, without inspecting or parsing untrusted JSON.
      const matches: {connection:Awaited<ReturnType<JobStore['clickupConnections']>>[number];webhook:string}[]=[];
      for(const connection of await store.clickupConnections()) for(const [webhook,sealed] of Object.entries(connection.webhook_secrets)) {
        if(verifyClickup(raw,signature,decryptToken(sealed,key))) matches.push({connection,webhook});
      }
      if(!matches.length) return Response.json({message:'Signature refused'},{status:401});
      let event: z.infer<typeof clickupEvent>;
      try { event=clickupEvent.parse(JSON.parse(raw)); }
      catch { return Response.json({message:'Event body is invalid'},{status:400}); }
      const matching=matches.filter(m=>m.webhook===event.webhook_id);
      if(!matching.length) return Response.json({message:'Signature refused'},{status:401});
      for(const {connection,webhook} of matching) await store.ingestClickup(connection,webhook,event.event,event.task_id,event.history_items,JSON.parse(raw));
      kick();
      return Response.json({ok:true});
    },
  };
}
export function tickHandler(store: JobStore, worker: ()=>Promise<number>, secret: string, daily=false): SystemHandler {
  return async request=>{
    if(!secret || !equalSecret(request.headers.get('Authorization') ?? '',`Bearer ${secret}`)) return Response.json({message:'Access refused'},{status:401});
    await store.schedule(Date.now(),daily);
    const processed=await worker();
    return Response.json({processed});
  };
}
