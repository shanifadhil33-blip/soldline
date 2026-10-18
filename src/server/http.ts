import 'server-only';
import { getMember } from './session';
import { withMember, type SqlConnection } from './db/withMember';
import { getAppDriver } from './db/runtime';
import { ForbiddenError, type Member } from './permissions';
import { append } from './audit';
export interface RouteContext { params: Promise<Record<string, string>> }
export function withMemberRoute(handler: (request: Request, context: RouteContext, member: Member, db: SqlConnection) => Promise<Response>) {
  return async (request: Request, context: RouteContext): Promise<Response> => {
    const member = await getMember(request);
    if (!member) return Response.json({ error: 'not_authenticated', message: 'Please sign in or try the demo.' }, { status: 401 });
    return withMember(getAppDriver(), member.id, async db => {
      // Refusals are caught inside the transaction so the denied audit record commits.
      // A handler must check permission before writes. Unexpected failures roll back normally.
      try { return await handler(request, context, member, db); }
      catch (error) {
        if (!(error instanceof ForbiddenError)) throw error;
        await append(db, member.workspace_id, { action: error.action, outcome: 'denied', target_type: 'run', target_id: error.resource.id });
        return Response.json({ error: 'not_allowed', message: error.message }, { status: 403 });
      }
    });
  };
}
