import { withMemberRoute } from '../../../server/http';
import { clientRecords } from '../../../server/trust';
export const GET=withMemberRoute(async(_request,_context,member,db)=>Response.json(await clientRecords(db,member)));
