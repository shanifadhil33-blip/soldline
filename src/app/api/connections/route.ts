import { assertCan } from '../../../server/permissions';
import { z } from 'zod';
import { getMember } from '../../../server/session';
import { getOwnerServices } from '../../../server/db/runtime';
export async function GET(request:Request) {
  const member=await getMember(request);if(!member)return Response.json({},{status:401});
  const result=await getOwnerServices().trust.connections(member);
  return Response.json(result??{},{status:result?200:403});
}
const schema=z.object({provider:z.enum(['hubspot','clickup','mail']),operation:z.enum(['pause','resume','reconnect']),token:z.string().min(1).max(10000).optional(),account:z.string().min(1).max(1000).optional()}).strict();
export async function POST(request:Request) {
  const member=await getMember(request);if(!member)return Response.json({},{status:401});
  const body=schema.safeParse(await request.json().catch(()=>null));if(!body.success)return Response.json({},{status:400});
  const {provider,operation,token,account}=body.data;
  const {status}=await getOwnerServices().trust.connection(member,provider,operation,token&&account?{token,account}:undefined,(actor,action,resource)=>assertCan(actor,action,resource));
  return Response.json({},{status});
}
