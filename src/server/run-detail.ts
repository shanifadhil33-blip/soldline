import 'server-only';
import { loadMessages, type Language } from '../lib/i18n';
import { getAppDriver, getOwnerServices } from './db/runtime';
import { withMember } from './db/withMember';
import { append } from './audit';
import { assertCan, ForbiddenError, type Member } from './permissions';
import { decisionAllowed } from './approvals/access';
import type { Kind } from './approvals/model';

/** Everything the project page shows. Used by the page itself (so it opens filled in) and by the refresh route. */
export async function readRunDetail(member: Member, id: string, language: Language) {
  const prepared = await withMember(getAppDriver(), member.id, async db => {
      try {
        const run = (await db.query<{ id: string; workspace_id: string; scope_version_id: string | null; plan: unknown; status: string }>('SELECT id,workspace_id,scope_version_id,plan,status FROM runs WHERE id=$1', [id])).rows[0];
        if (!run) return { status: 404 as const };
        const company = (await db.query<{ client_company_id: string }>('SELECT d.client_company_id FROM deals d JOIN runs r ON r.workspace_id=d.workspace_id AND r.deal_id=d.id WHERE r.id=$1', [id])).rows[0];
        if (member.roles.includes('client_reviewer') && (!member.client_company_id || company?.client_company_id !== member.client_company_id)) return { status: 404 as const };
        assertCan(member, 'see_runs', { ...run, client_company_id: company?.client_company_id, task_member_ids: [member.id] });
        const items = (await db.query('SELECT key,title,quantity,cadence,source_page,source_quote FROM scope_items WHERE scope_version_id=$1 ORDER BY key', [run.scope_version_id])).rows;
        const inputs = (await db.query('SELECT id,key,label,status,evidence FROM onboarding_inputs WHERE run_id=$1 ORDER BY id', [id])).rows;
        if (member.roles.includes('client_reviewer')) return { status: 200 as const, body: { run: { id: run.id, status: run.status }, items, inputs } };
        const scope = (await db.query('SELECT id,version,status,items_hash FROM scope_versions WHERE id=$1', [run.scope_version_id])).rows[0] ?? null;
        const findings = (await db.query('SELECT id,kind,severity,title,evidence,status FROM findings WHERE run_id=$1 ORDER BY id', [id])).rows;
        const approvals = (await db.query<{ kind: Kind; requested_by_type: 'user' | 'agent' | null; requested_by_member_id: string | null }>('SELECT * FROM approvals WHERE run_id=$1 ORDER BY expires_at DESC,id', [id])).rows.map(approval => ({ ...approval, canDecide: decisionAllowed(member, approval) }));
        const title = (await db.query<{ name: string }>('SELECT name FROM deals WHERE id=(SELECT deal_id FROM runs WHERE id=$1)', [id])).rows[0]?.name;
        const members = (await db.query('SELECT id,display_name,clickup_user_id FROM members WHERE archived_at IS NULL')).rows;
        const emails = (await db.query('SELECT id,direction,raw,status FROM sample_mail WHERE run_id=$1 ORDER BY created_at,id', [id])).rows.map(email => ({ ...email, status: loadMessages(language).backendA4.sampleNotSent }));
        return { status: 200 as const, body: { emails, run, scope, items, inputs, findings, approvals, title, members, isDemo: member.is_demo }, history: true };
      } catch (error) {
        if (!(error instanceof ForbiddenError)) throw error;
        await append(db, member.workspace_id, { action: error.action, outcome: 'denied', target_type: 'run', target_id: error.resource.id });
        return { status: 403 as const, message: error.message };
      }
  });
  if (prepared.status !== 200) return prepared;
  if (!('history' in prepared) || !prepared.history) return prepared;
  const history = await getOwnerServices().readRunHistory(member, id);
  return { status: 200 as const, body: { ...prepared.body, history } };
}
