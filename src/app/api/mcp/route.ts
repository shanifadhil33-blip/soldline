import { mcpPost } from '../../../server/mcp';
import { assertCan } from '../../../server/permissions';
export async function POST(request:Request){return mcpPost(request,(member,action,resource)=>assertCan(member,action,resource));}
