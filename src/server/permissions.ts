export const roles = ['admin', 'account_manager', 'delivery_lead', 'contributor', 'client_reviewer'] as const;
export type Role = typeof roles[number];
export interface Member {
  id: string;
  workspace_id: string;
  display_name: string;
  roles: Role[];
  client_company_id: string | null;
  is_demo: boolean;
}
export interface Resource {
  id?: string;
  workspace_id: string;
  client_company_id?: string | null;
  owner_member_id?: string | null;
  task_member_ids?: string[];
  requested_by_type?: 'user' | 'agent';
  requested_by_member_id?: string | null;
  intent?: 'propose' | 'suggest' | 'request';
}
type Rule = (member: Member, resource: Resource) => boolean;
const yes: Rule = () => true;
const no: Rule = () => false;
const own: Rule = (m, r) => r.owner_member_id === m.id;
const company: Rule = (m, r) => !!m.client_company_id && m.client_company_id === r.client_company_id;
const tasks: Rule = (m, r) => r.task_member_ids?.includes(m.id) === true;
// The single matrix. Scope acceptance grants eligibility only; the quorum helper is also required.
export const matrix = {
  see_runs: [yes, yes, yes, tasks, company],
  approve_plan: [yes, no, yes, no, no],
  approve_client_email: [yes, yes, no, no, no],
  propose_scope_change: [yes, yes, yes, (_m, r) => r.intent === 'suggest', (m, r) => r.intent === 'request' && company(m, r)],
  accept_scope_change: [yes, yes, yes, no, no],
  resolve_recovery: [yes, own, own, no, no],
  reverse_effect: [yes, no, yes, no, no],
  manage_connections_roles: [yes, no, no, no, no],
  mark_input_received: [yes, yes, yes, yes, company],
  read_audit: [yes, own, own, no, no],
} satisfies Record<string, [Rule, Rule, Rule, Rule, Rule]>;
export type Action = keyof typeof matrix;
const approvals = new Set<Action>(['approve_plan', 'approve_client_email', 'accept_scope_change', 'reverse_effect']);
export function can(member: Member, action: Action, resource: Resource): boolean {
  if (member.workspace_id !== resource.workspace_id) return false;
  if (approvals.has(action) && resource.requested_by_type === 'user' && resource.requested_by_member_id === member.id) return false;
  const rules: Rule[] = matrix[action];
  return !!rules && member.roles.some(role => { const i = roles.indexOf(role); return i >= 0 && rules[i](member, resource); });
}
export class ForbiddenError extends Error {
  constructor(public action: Action, public resource: Resource, message: string) { super(message); this.name = 'ForbiddenError'; }
}
export function assertCan(member: Member, action: Action, resource: Resource): void {
  if (!can(member, action, resource)) {
    const message = action === 'approve_plan' && member.roles.length === 1 && member.roles[0] === 'contributor'
      ? 'Only a delivery lead or the agency director can approve delivery plans.' : 'You do not have permission to perform this action.';
    throw new ForbiddenError(action, resource, message);
  }
}
/** Each entry represents a distinct human approver. One person with two roles is one approval. */
export function scopeAcceptanceMet(approverRoleSets: readonly (readonly Role[])[]): boolean {
  return approverRoleSets.some((a, i) => approverRoleSets.some((b, j) => i !== j && (
    (a.includes('account_manager') && b.includes('delivery_lead')) ||
    (a.includes('admin') && (b.includes('account_manager') || b.includes('delivery_lead')))
  )));
}
