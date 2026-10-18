import { approvalRoute } from '../../../../../server/approvals/http';
import { assertCan } from '../../../../../server/permissions';
import type { RouteContext } from '../../../../../server/http';
export async function POST(request:Request,context:RouteContext) {
  return approvalRoute(request,context,'confirm',(member,action,resource)=>assertCan(member,action,resource));
}
