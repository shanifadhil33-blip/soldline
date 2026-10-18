import { recoveryRoute } from '../../../../../server/recovery/http';
import { assertCan } from '../../../../../server/permissions';
import type { RouteContext } from '../../../../../server/http';
export const POST=(request:Request,context:RouteContext)=>recoveryRoute(request,context,'action',(member,action,resource)=>assertCan(member,action,resource));
