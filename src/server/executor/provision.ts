import type { Payload } from '../approvals/model';
// The resulting payload is the exact work shown on the normal P7 approval card.
export function provisionPayload(input:{spaceId:string;folderName:string;dealId:string;runRef:string;planUrl:string;tasks:{key:string;name:string;list:string;assignees:number[];due_date:number}[];missingLineItems:number;ownerMemberId:string}):Payload {
  const effect=(system:Payload['effects'][number]['system'],action:string,location:string,records: {id:string;values:Record<string,string|number|number[]>}[])=>({system,action,location,records:records.map(r=>({id:r.id,fields:Object.fromEntries(Object.entries(r.values).map(([key,after])=>[key,{before:null,after}]))})),amounts:{}});
  return {effects:[
    effect('clickup','create_folder',input.spaceId,[{id:'folder',values:{name:input.folderName}}]),
    effect('clickup','create_list','@folder',[...new Set(input.tasks.map(t=>t.list))].map(name=>({id:name,values:{name}}))),
    ...[...new Set(input.tasks.map(t=>t.list))].map(list=>effect('clickup','create_task','@list:'+list,input.tasks.filter(t=>t.list===list).map(t=>({id:t.key,values:{name:t.name,assignees:t.assignees,due_date:t.due_date}})))),
    effect('hubspot','patch_deal_properties',input.dealId,[{id:input.dealId,values:{soldline_delivery_status:'Ready',soldline_plan_url:input.planUrl,soldline_run_ref:input.runRef}}]),
    ...(input.missingLineItems?[effect('soldline','create_recovery','run',[{id:'missing line items',values:{title:`Add the ${input.missingLineItems} missing line items in HubSpot`,owner_member_id:input.ownerMemberId}}])]:[]),
  ]};
}
