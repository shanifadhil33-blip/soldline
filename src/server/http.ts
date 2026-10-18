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
    try { return await withMember(getAppDriver(), member.id, async db => {
      // Refusals are caught inside the transaction so the denied audit record commits.
      // A handler must check permission before writes. Unexpected failures roll back normally.
      try { return await handler(request, context, member, db); }
      catch (error) {
        if (!(error instanceof ForbiddenError)) throw error;
        await append(db, member.workspace_id, { action: error.action, outcome: 'denied', target_type: 'run', target_id: error.resource.id });
        return Response.json({ error: 'not_allowed', message: error.message }, { status: 403 });
      }
    }); } catch {
      // The transaction rolled back. Answer in words without internal details.
      return fail(500);
    }
  };
}
const errorDefaults: Record<number, [string, string]> = {
  400: ['invalid_request', 'Check the details and try again.'],
  401: ['not_authenticated', 'Please sign in or try the demo.'],
  403: ['not_allowed', 'You do not have permission to do this.'],
  404: ['not_found', 'Record not found'],
  405: ['method_not_allowed', 'This action is not available here.'],
  409: ['conflict', 'This was already changed. Refresh and try again.'],
  429: ['too_many_requests', 'Too many requests. Wait a minute and try again.'],
  500: ['server_error', 'Something went wrong on our side. Try again in a minute.'],
  502: ['provider_down', 'A connected service did not answer. Try again in a minute.'],
  503: ['unavailable', 'Soldline is busy right now. Try again in a minute.'],
};
/** Every error answer carries a code and a plain sentence, never an empty body. */
export function fail(status: number, message?: string, code?: string): Response {
  const [fallbackCode, fallbackMessage] = errorDefaults[status] ?? errorDefaults[status >= 500 ? 500 : 400];
  return Response.json({ error: code ?? fallbackCode, message: message ?? fallbackMessage }, { status });
}
/** Answers a store status: success gets ok and a message, anything else gets fail(). */
export function answer(status: number, message: string): Response {
  return status < 400 ? Response.json({ ok: true, message }, { status }) : fail(status);
}
