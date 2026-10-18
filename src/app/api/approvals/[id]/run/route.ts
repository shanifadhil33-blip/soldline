import { after } from 'next/server';
import { approvalRoute } from '../../../../../server/approvals/http';
import { assertCan } from '../../../../../server/permissions';
import { runWorker } from '../../../../../server/jobs/runtime';
import type { RouteContext } from '../../../../../server/http';
// The screen entry point uses the existing P7 HTTP boundary and schedules the existing P8 worker.
export async function POST(request:Request,context:RouteContext) {
  const response=await approvalRoute(request,context,'execute',(member,action,resource)=>assertCan(member,action,resource));
  if(response.ok)after(async()=>{await runWorker();});
  return response;
}
