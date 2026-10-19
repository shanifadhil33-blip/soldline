import 'server-only';
import { z } from 'zod';
import { getAppDriver, getOwnerServices } from './db/runtime';
import { withMember } from './db/withMember';
import { fail } from './http';
import { assertCan, ForbiddenError } from './permissions';
import { append } from './audit';
import { copy, permittedData } from './backend-a5';
import { createSchema } from './approvals/model';
const tools=[
 {name:'list_runs',description:copy.runs,inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'get_run',description:copy.runs,inputSchema:{type:'object',properties:{runId:{type:'string',format:'uuid'}},required:['runId'],additionalProperties:false}},
 {name:'list_findings',description:copy.findings,inputSchema:{type:'object',properties:{runId:{type:'string',format:'uuid'}},additionalProperties:false}},
 {name:'propose_plan_correction',description:copy.draft,inputSchema:z.toJSONSchema(createSchema.omit({kind:true,requestedByType:true,requestedByMemberId:true}))},
];
const envelope=z.object({jsonrpc:z.literal('2.0'),id:z.union([z.string(),z.number(),z.null()]).optional(),method:z.string(),params:z.unknown().optional()}).strict();
export async function mcpPost(request:Request,guard:typeof assertCan=assertCan){
 const secret=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization')??'')?.[1];
 if(!secret)return fail(401);
 try{
 const auth=await getOwnerServices().agent.authenticate(secret);if(!auth.member)return fail(auth.status);
 const member=auth.member;
 let parseFailed=false;const body=await request.json().catch(()=>{parseFailed=true;return null;});
 const parsed=envelope.safeParse(body);
 const rpcError=(code:number,message:string,id:string|number|null=null)=>Response.json({jsonrpc:'2.0',id,error:{code,message}});
 if(!parsed.success)return rpcError(parseFailed?-32700:-32600,copy.rpc);
 const {method,params}=parsed.data;const id=parsed.data.id??null;
 if(parsed.data.id===undefined){
   if(method==='notifications/initialized')return new Response(null,{status:202});
   return rpcError(-32600,copy.rpc);
 }
 const result=(value:unknown)=>Response.json({jsonrpc:'2.0',id,result:value});
 if(method==='initialize'){
   if(!z.object({protocolVersion:z.string(),capabilities:z.object({}).passthrough(),clientInfo:z.object({name:z.string(),version:z.string()}).passthrough()}).passthrough().safeParse(params).success)return rpcError(-32602,copy.params,id);
   return result({protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'Soldline',version:'0.1.0'}});
 }
 if(method==='tools/list'){if(params!==undefined&&!z.object({cursor:z.string().optional()}).strict().safeParse(params).success)return rpcError(-32602,copy.params,id);return result({tools});}
 if(method!=='tools/call')return rpcError(-32601,copy.unknownMethod,id);
 const call=z.object({name:z.string(),arguments:z.unknown().optional()}).strict().safeParse(params);
 if(!call.success)return rpcError(-32602,copy.params,id);
 const {name}=call.data,args=call.data.arguments??{};
 if(!tools.some(t=>t.name===name))return rpcError(-32602,copy.unknownTool,id);
 const proposal=createSchema.omit({kind:true,requestedByType:true,requestedByMemberId:true}).safeParse(args);
 const read=z.object({runId:z.uuid().optional()}).strict().safeParse(args);
 if(name==='propose_plan_correction'?!proposal.success:!read.success||name==='get_run'&&!read.data.runId||name==='list_runs'&&read.data.runId)return rpcError(-32602,copy.params,id);
 if(name==='propose_plan_correction'&&proposal.success&&proposal.data.payload.effects.some(e=>['retry_recovery','accept_scope_change'].includes(e.action)))return rpcError(-32602,copy.params,id);
 const data=await withMember(getAppDriver(),member.id,async db=>{
   try{
     guard(member,'see_runs',{workspace_id:member.workspace_id,client_company_id:member.client_company_id,task_member_ids:[member.id]});
     if(name==='propose_plan_correction'&&proposal.success){
       // Check matrix permissions even for a member whose RLS run collection is empty.
       guard(member,'propose_scope_change',{workspace_id:member.workspace_id,intent:'propose'});
       const run=(await db.query('SELECT id FROM runs WHERE id=$1',[proposal.data.runId])).rows[0];
       return run?{proposal:proposal.data}:{error:404};
     }
     const all=await permittedData(db,member);
     const runId=read.success?read.data.runId:undefined;
     if(name==='get_run'){
       if(member.roles.includes('client_reviewer')){
         const visible=(await db.query('SELECT r.id FROM runs r JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id WHERE r.id=$1 AND d.client_company_id=$2',[runId,member.client_company_id])).rows[0];
         return visible?{value:{id:runId,inputs:all.inputs.filter(r=>r.run_id===runId),deliverables:all.tasks.filter(r=>r.run_id===runId)}}:{error:404};
       }
       const run=all.runs.find(r=>r.id===runId);return run?{value:{...run,findings:all.findings.filter(r=>r.run_id===runId)}}:{error:404};
     }
     if(name==='list_runs'){
       const rows=member.roles.includes('client_reviewer')?(await db.query('SELECT r.id FROM runs r JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id WHERE d.client_company_id=$1',[member.client_company_id])).rows:all.runs;
       return {value:rows};
     }
     return {value:(all.findings??[]).filter(r=>!runId||r.run_id===runId)};
   }catch(error){if(!(error instanceof ForbiddenError))throw error;await append(db,member.workspace_id,{action:error.action,outcome:'denied',target_id:error.resource.id});return {error:403};}
 });
 if(data.error)return rpcError(data.error===403?-32003:-32004,(await fail(data.error).json()).message,id);
 if(data.proposal){try{const a=await getOwnerServices().approvals.createApproval({...data.proposal,kind:'plan_correction',requestedByType:'agent',requestedByMemberId:member.id},member);if(a.status>=400)return rpcError(-32003,a.message,id);return result({content:[{type:'text',text:JSON.stringify({approvalId:a.approval?.id,message:a.message})}]});}catch{return rpcError(-32602,copy.params,id);}}
 return result({content:[{type:'text',text:JSON.stringify(data.value)}]});
 }catch{return fail(500);}
}
