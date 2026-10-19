import { http,HttpResponse } from 'msw';
import { randomUUID } from 'node:crypto';
import type { TransactionDriver } from '@/server/db/withMember';
import type { ownerServices } from '@/server/db/owner';
import type { Member } from '@/server/permissions';
import { hash } from '@/server/approvals/model';
import { provisionPayload } from '@/server/executor/provision';
import { encryptToken } from '@/server/crypto';
import { scopeTitles } from '@/server/demo/seed';
type Row=Record<string,unknown>&{id:string;name:string;parent:string;date_updated:string};
const folders:Row[]=[],lists:Row[]=[],tasks:Row[]=[];
const properties:Record<string,Record<string,string>>={};
export const coreHandlers=[http.all('https://api.clickup.com/*',async({request})=>{
  const url=new URL(request.url),parts=url.pathname.split('/'),kind=parts.at(-1),parent=parts.at(-2)!;
  if(request.method==='GET') {
    if(kind==='task')return HttpResponse.json({tasks:tasks.filter(t=>t.parent===parent),last_page:true});
    if(kind==='list')return HttpResponse.json({lists:lists.filter(t=>t.parent===parent)});
    if(kind==='folder')return HttpResponse.json({folders:folders.filter(t=>t.parent===parent)});
    return HttpResponse.json([...folders,...lists,...tasks].find(t=>t.id===kind)??{id:kind,name:'Sample list'});
  }
  const body=await request.json() as Record<string,unknown>;
  const collection=kind==='folder'?folders:kind==='list'?lists:tasks;
  const row={...body,id:randomUUID().replaceAll('-',''),name:String(body.name),parent,date_updated:'100',markdown_description:body.markdown_content,status:{status:'open'}};
  collection.push(row);return HttpResponse.json(row);
}),http.all('https://api.hubapi.com/*',async({request})=>{
  const id=new URL(request.url).pathname.split('/').at(-1)!;
  const props=properties[id]??={hs_lastmodifieddate:'1000',soldline_delivery_status:'Waiting',soldline_plan_url:'',soldline_run_ref:''};
  if(request.method==='PATCH') Object.assign(props,(await request.json() as {properties:object}).properties,{hs_lastmodifieddate:'2000'});
  return HttpResponse.json({id,properties:props});
})];
export async function prepareCore(owner:TransactionDriver,services:ReturnType<typeof ownerServices>,ws:string) {
  const setup=await owner.transaction(async db=>{
    // The demo seed now holds display approvals, so mark fixture preparation by its own analyse job instead.
    if((await db.query("SELECT id FROM jobs WHERE workspace_id=$1 AND kind='analyse_deal' AND dedupe_key LIKE 'deal:%:analyse'",[ws])).rows.length)return null;
    const members=(await db.query<Member&{preferred_name:string}>('SELECT *,true AS is_demo FROM members WHERE workspace_id=$1',[ws])).rows;
    const omar=members.find(m=>m.preferred_name==='omar')!,imran=members.find(m=>m.preferred_name==='imran')!,ravi=members.find(m=>m.preferred_name==='ravi')!;
    const run=(await db.query<{id:string;deal_id:string;scope_version_id:string;hubspot_deal_id:string}>('SELECT r.*,d.hubspot_deal_id FROM runs r JOIN deals d ON d.id=r.deal_id WHERE r.workspace_id=$1 AND r.scope_version_id IS NOT NULL',[ws])).rows[0];
    const scope=(await db.query<{id:string;version:number;items_hash:string|null;status:string}>('SELECT id,version,items_hash,status FROM scope_versions WHERE id=$1',[run.scope_version_id])).rows[0];
    const now=new Date(),won=new Date(now.getTime()-3600000).toISOString();
    await db.query('UPDATE members SET clickup_user_id=$2 WHERE id=$1',[ravi.id,'42']);
    const plan={tasks:scopeTitles.map((title,i)=>({scopeItem:i+1,title,list:['Setup','Content','Ads','Reporting'][Math.floor(i/2)],owner:ravi.id,due:new Date(now.getTime()+86400000*(i+1)).toISOString()}))};
    await db.query('UPDATE runs SET plan=$2,delivery_lead_id=$3,won_at=$4 WHERE id=$1',[run.id,JSON.stringify(plan),imran.id,won]);
    await db.query("UPDATE onboarding_inputs SET requested_at=now()-interval '4 days' WHERE run_id=$1",[run.id]);
    // Replace the seeded display approvals with the executable fixture approvals created below.
    await db.query('DELETE FROM approvals WHERE run_id=$1',[run.id]);
    await db.query('DELETE FROM findings WHERE run_id=$1',[run.id]);
    for(const title of [scopeTitles[0],scopeTitles[1],scopeTitles[5],scopeTitles[6]])await db.query("INSERT INTO findings(workspace_id,run_id,kind,severity,status,title,owner_member_id,evidence) VALUES($1,$2,'scope_mismatch','block','open',$3,$4,$5)",[ws,run.id,`No HubSpot line item for ${title}.`,ravi.id,JSON.stringify([{source:'Signed scope page 2',quote:title,record_ref:'No matching line item',rule:'sold_not_in_crm'}])]);
    await db.query("INSERT INTO findings(workspace_id,run_id,kind,severity,status,title,evidence) VALUES($1,$2,'missing_input','warn','open','No Meta ad account access yet.',$3)",[ws,run.id,JSON.stringify([{source:'Client inputs',quote:'Meta ad account access not received',record_ref:'Meta ad account access',rule:'missing_input'}])]);
    for(const provider of ['hubspot','clickup'])await db.query("INSERT INTO connections(workspace_id,provider,status,external_account_id,token_ciphertext,won_stage_id,delivery_lead_id) VALUES($1,$2,'connected','sample',$3,'won',$4) ON CONFLICT (workspace_id,provider) DO UPDATE SET status=EXCLUDED.status,external_account_id=EXCLUDED.external_account_id,token_ciphertext=EXCLUDED.token_ciphertext,won_stage_id=EXCLUDED.won_stage_id,delivery_lead_id=EXCLUDED.delivery_lead_id",[ws,provider,encryptToken('local fixture only '+ws),imran.id]);
    const eventId=randomUUID(),event={portalId:'sample',eventId,objectId:run.hubspot_deal_id,subscriptionType:'deal.propertyChange',propertyName:'dealstage',propertyValue:'won'};
    await db.query("INSERT INTO inbound_events(id,workspace_id,source,dedupe_key,raw,received_at) VALUES($1,$2,'hubspot',$3,$4,now())",[eventId,ws,eventId,JSON.stringify(event)]);
    await db.query('UPDATE runs SET trigger_event_id=$2 WHERE id=$1',[run.id,eventId]);
    await db.query("INSERT INTO jobs(workspace_id,run_id,kind,dedupe_key,payload,status,attempts) VALUES($1,$2,'analyse_deal',$3,'{}','done',1)",[ws,run.id,`deal:${run.hubspot_deal_id}:analyse`]);
    return {run,scope,omar,imran,plan};
  });
  if(!setup)return;
  const {run,scope,omar,imran,plan}=setup;
  const payload=provisionPayload({spaceId:'sample',folderName:'Harbor Coffee Roasters',dealId:run.hubspot_deal_id,runRef:run.id.replaceAll('-',''),planUrl:'https://example.test/plan',tasks:plan.tasks.map((t,i)=>({key:String(i+1),name:t.title,list:t.list,assignees:[42],due_date:Date.parse(t.due)})),missingLineItems:4,ownerMemberId:omar.id});
  const created=await services.approvals.createApproval({runId:run.id,kind:'provision',payload,inputRefs:[{system:'scope',record_id:run.deal_id,version_marker:String(scope.version),hash:hash(scope)}],reversibility:'reversible'},omar);
  if(created.status!==201)throw new Error('Fixture approval preparation failed');
  // A separate exact approval exercises the real live input comparison and persisted stale state.
  const stale=await services.approvals.createApproval({runId:run.id,kind:'plan_correction',payload:{effects:[{system:'hubspot',location:run.hubspot_deal_id,action:'patch_deal_properties',records:[{id:run.hubspot_deal_id,fields:{amount:{before:'18000',after:'18000'}}}],amounts:{AED:18000}}]},inputRefs:[{system:'hubspot',record_id:run.hubspot_deal_id,version_marker:'old',hash:hash('old')}],reversibility:'reversible'},omar);
  if(!stale.approval)throw new Error('Fixture stale preparation failed');
  await services.approvals.decide(stale.approval.id,imran,'approve','');
  const refused=await services.approvals.execute(stale.approval.id,imran);
  if(refused.status!==409)throw new Error('Fixture stale refusal failed');
  const email=await services.approvals.createApproval({runId:run.id,kind:'client_email',requestedByType:'agent',payload:{effects:[{system:'mail',location:'Team inbox',action:'send_message',records:[{id:'Karim',fields:{subject:{before:null,after:'Meta account access'}}}],amounts:{},message:{to:['karim@example.test'],subject:'Meta account access',body:'Hello Karim. Please share Meta account access before launch. Thank you, Omar.'}}]},inputRefs:[{system:'scope',record_id:run.deal_id,version_marker:String(scope.version),hash:hash(scope)}],reversibility:'irreversible'},omar);
  if(email.status!==201)throw new Error('Fixture email preparation failed');
}
