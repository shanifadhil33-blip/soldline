import { bypass, HttpResponse } from 'msw';
import { z } from 'zod';
// Every path, including provisional paths, must be confirmed explicitly before any network access.
export const requiredPaths=['hubspotDealCreate','hubspotDeal','hubspotDealCleanup','hubspotLineItems','hubspotLineItemUpdate','hubspotSearch','hubspotOwners','hubspotNotes','hubspotFileSignedUrl','hubspotAssociation','hubspotFilesSearch','hubspotFilesUpload','hubspotNotesSearch','hubspotNotesCreate','hubspotCompanySearch','hubspotCompanyCreate','hubspotContactSearch','hubspotContactCreate','hubspotProductSearch','hubspotProductCreate','hubspotLineItemSearch','hubspotLineItemCreate','clickupFolders','clickupFolderLists','clickupListTasks','clickupTask','clickupFolderTasks','clickupFolderCleanup','mailInbox','mailMessages','mailMessage','mailThread','mailDrafts','mailSend'] as const;
type PathKey=typeof requiredPaths[number];
const envValue=(env:Record<string,string|undefined>,key:string)=>{const value=env[key]?.trim();if(!value) throw new Error('Live setting is required: '+key);return value;};
export function liveConfig(env:Record<string,string|undefined>) {
  if(env.LIVE_SANDBOX!=='1') throw new Error('Live sandbox mode is required');
  if(env.LIVE_PATHS_CONFIRMED!=='yes') throw new Error('Bilal must confirm every provider path');
  const raw=JSON.parse(envValue(env,'LIVE_PROVIDER_PATHS')) as Record<string,unknown>;
  const paths={} as Record<PathKey,string>;
  const placeholders:Partial<Record<PathKey,string[]>>={hubspotDeal:['id'],hubspotDealCleanup:['id'],hubspotLineItemUpdate:['id'],hubspotFileSignedUrl:['id'],hubspotAssociation:['fromType','fromId','toType','toId'],clickupFolders:['space'],clickupFolderLists:['folder'],clickupListTasks:['list'],clickupTask:['task'],clickupFolderTasks:['folder'],clickupFolderCleanup:['folder'],mailInbox:['inbox'],mailMessages:['inbox'],mailMessage:['inbox','id'],mailThread:['inbox','id'],mailDrafts:['inbox'],mailSend:['inbox','id']};
  for(const key of requiredPaths) {
    const value=raw[key];
    if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||(key==='clickupFolderTasks'?/[#\\]/.test(value):/[?#\\]/.test(value))||value.includes('..')||(placeholders[key]??[]).some(p=>!value.includes('{'+p+'}'))) throw new Error('Live provider path needs confirmation: '+key);
    paths[key]=value;
  }
  const mailBase=new URL(envValue(env,'LIVE_MAIL_BASE'));if(mailBase.protocol!=='https:') throw new Error('Live mail base needs HTTPS');
  const lineIds=envValue(env,'LIVE_LINE_IDS').split(',').map(s=>s.trim());if(lineIds.length!==4||lineIds.some(s=>!s)) throw new Error('Four live line items are required');
  const assignee=Number(envValue(env,'LIVE_CLICKUP_ASSIGNEE'));if(!Number.isSafeInteger(assignee)||assignee<=0) throw new Error('Live owner needs a ClickUp user id');
  const dealBody=z.object({properties:z.record(z.string(),z.string())}).passthrough().parse(JSON.parse(envValue(env,'LIVE_DEAL_BODY')));
  return {paths,mailBase:mailBase.toString().replace(/\/$/,''),portal:envValue(env,'LIVE_HUBSPOT_PORTAL'),space:envValue(env,'LIVE_CLICKUP_SPACE'),workloadList:envValue(env,'LIVE_WORKLOAD_LIST'),assignee,lineIds,dealBody,wonStage:envValue(env,'LIVE_WON_STAGE'),tokens:{hubspot:envValue(env,'LIVE_HUBSPOT_TOKEN'),clickup:envValue(env,'LIVE_CLICKUP_TOKEN'),mail:envValue(env,'LIVE_MAIL_TOKEN')}};
}
type Config=ReturnType<typeof liveConfig>;
export function liveProviders(config:Config) {
  const counts={hubspot:0,clickup:0,mail:0};
  const deals:string[]=[],folders:string[]=[],lists:string[]=[];const lineEdits:Array<{id:string;name:string}>=[];let listNames:string[]=[];
  let currentFolder='',currentTasks:string[]=[],created=0,outageUsed=false;
  const observed=new Map<string,Record<string,unknown>>();let cachedObservations=0;
  const expand=(key:PathKey,values:Record<string,string>={})=>config.paths[key].replace(/\{(\w+)\}/g,(_,p:string)=>{if(!values[p]) throw new Error('Live path value is missing');return encodeURIComponent(values[p]);});
  async function call(provider:keyof typeof counts,method:string,path:string,body?:unknown,cleanup=false) {
    // Reserve one cleanup call for every created folder. Refuse before exceeding 60.
    if(provider==='clickup' && counts.clickup>=60-(cleanup?0:folders.length+(method==='POST'&&path===expand('clickupFolders',{space:config.space})?1:0))) throw new Error('ClickUp call budget reached');
    counts[provider]++;
    const base=provider==='hubspot'?'https://api.hubapi.com':provider==='clickup'?'https://api.clickup.com':config.mailBase;
    const response=await fetch(bypass(base+path,{method,redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:provider==='clickup'?config.tokens[provider]:'Bearer '+config.tokens[provider],'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}));
    if(!response.ok) throw new Error('Live '+provider+' request failed with status '+response.status);
    return response;
  }
  const object=z.object({id:z.string(),properties:z.record(z.string(),z.string().nullable())});
  return {
    config,token:(provider:string)=>config.tokens[provider as keyof typeof counts],
    async createDeal(ref:string) {currentFolder='';currentTasks=[];listNames=[];created=0;outageUsed=false;const response=await call('hubspot','POST',expand('hubspotDealCreate'),{...config.dealBody,properties:{...config.dealBody.properties,dealname:'Harbor Coffee Roasters '+ref}});const deal=object.parse(await response.json());deals.push(deal.id);return deal.id;},
    listNames:()=>listNames,
    taskDetails:()=>currentTasks.map(id=>observed.get(id)!),
    async deliveryStatus(id:string) {const response=await call('hubspot','GET',expand('hubspotDeal',{id}));return object.parse(await response.json()).properties.soldline_delivery_status;},
    async markWon(id:string) {await call('hubspot','PATCH',expand('hubspotDeal',{id}),{properties:{dealstage:config.wonStage}});},
    async line(id:string) {const response=await call('hubspot','POST',expand('hubspotLineItems'),{properties:['name','quantity','price','hs_product_id','hs_sku','description','hs_lastmodifieddate'],inputs:[{id}]});return z.object({results:z.array(object)}).parse(await response.json()).results[0];},
    async editLine(id:string) {
      const response=await call('hubspot','POST',expand('hubspotLineItems'),{properties:['name'],inputs:[{id}]});
      const current=z.object({results:z.array(object)}).parse(await response.json()).results.find(row=>row.id===id);
      const name=z.string().min(1).parse(current?.properties.name);lineEdits.push({id,name});
      await call('hubspot','PATCH',expand('hubspotLineItemUpdate',{id}),{properties:{name:name+' LIVE edit'}});
    },
    async handle(request:Request,fault:{outage:()=>boolean;revoked:()=>boolean;messages:unknown[]}) {
      const u=new URL(request.url),p=u.pathname.split('/'),method=request.method;
      if(u.hostname==='api.agentmail.to') {
        // Client mail and revoked credentials are explicit scenario inputs in both modes. No mail is sent.
        return fault.revoked()?new HttpResponse(null,{status:401}):HttpResponse.json({messages:fault.messages});
      }
      const provider=u.hostname==='api.clickup.com'?'clickup':'hubspot';let path:string;
      if(provider==='hubspot') path=u.pathname.endsWith('/batch/read')?expand('hubspotLineItems'):u.pathname.endsWith('/search')?expand('hubspotSearch'):expand('hubspotDeal',{id:p.at(-1)!});
      else {
        if(method==='GET'&&/\/task\/[^/]+$/.test(u.pathname)) {const cached=observed.get(p.at(-1)!);if(!cached) throw new Error('A task observation is missing');cachedObservations++;return HttpResponse.json(cached);}
        if(u.pathname.endsWith('/folder')) path=expand('clickupFolders',{space:p.at(-2)!});
        else if(u.pathname.endsWith('/list')) path=expand('clickupFolderLists',{folder:p.at(-2)!});
        else if(u.pathname.endsWith('/task')) path=expand('clickupListTasks',{list:p.at(-2)!});
        else path=expand('clickupTask',{task:p.at(-1)!});
        if(method==='POST'&&u.pathname.endsWith('/task')&&fault.outage()&&created===5&&!outageUsed) {outageUsed=true;return new HttpResponse(null,{status:503});}
      }
      const body=['GET','HEAD'].includes(method)?undefined:await request.json();
      const response=await call(provider,method,path+u.search,body);
      const data=await response.json() as Record<string,unknown>;
      if(provider==='clickup'&&method==='POST') {
        const id=z.string().parse(data.id);
        if(u.pathname.endsWith('/folder')) {folders.push(id);currentFolder=id;}
        else if(u.pathname.endsWith('/list')) {lists.push(id);listNames.push(z.string().parse(data.name));}
        else if(u.pathname.endsWith('/task')) {created++;currentTasks.push(id);observed.set(id,data);}
      }
      return HttpResponse.json(data);
    },
    async taskCount(verify=false) {
      if(!verify) return created;
      const response=await call('clickup','GET',expand('clickupFolderTasks',{folder:currentFolder}));
      const data=z.object({tasks:z.array(z.object({id:z.string(),list:z.object({id:z.string()}).optional()})),last_page:z.boolean().optional()}).parse(await response.json());
      if(data.last_page===false) throw new Error('The confirmed count path must return the complete folder');
      const ids=data.tasks.map(t=>t.id);
      if(new Set(ids).size!==ids.length) throw new Error('Live task ids are duplicated');
      return ids.length;
    },
    async cleanup() {
      const errors:string[]=[];
      for(const folder of folders.reverse()) {try {await call('clickup','DELETE',expand('clickupFolderCleanup',{folder}),undefined,true);} catch {errors.push('ClickUp folder '+folder);}}
      for(const edit of lineEdits.reverse()) {try {await call('hubspot','PATCH',expand('hubspotLineItemUpdate',{id:edit.id}),{properties:{name:edit.name}},true);} catch {errors.push('HubSpot line item '+edit.id);}}
      for(const id of deals.reverse()) {try {await call('hubspot','DELETE',expand('hubspotDealCleanup',{id}),undefined,true);} catch {errors.push('HubSpot deal '+id);}}
      process.stdout.write('Provider calls '+JSON.stringify(counts)+'\nCached task observations '+cachedObservations+'\n');
      if(errors.length) throw new Error('Live cleanup needs attention: '+errors.join(', '));
    },
  };
}
export type LiveProviders=ReturnType<typeof liveProviders>;
