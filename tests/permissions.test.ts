import { describe, expect, it } from 'vitest';
import { assertCan, can, matrix, roles, scopeAcceptanceMet, type Action, type Member, type Resource } from '../src/server/permissions';
const m: Member = { id: 'member', workspace_id: 'workspace', display_name: 'Faisal Rahman', roles: [], client_company_id: 'company', is_demo: true };
const resource: Resource = { id: 'run', workspace_id: 'workspace', client_company_id: 'company', owner_member_id: m.id, task_member_ids: [m.id] };
// Independent expectations taken from the agreed table. Every role and action has its own test.
const expected: Record<Action, boolean[]> = {
  see_runs: [true,true,true,true,true],
  approve_plan: [true,false,true,false,false],
  approve_client_email: [true,true,false,false,false],
  propose_scope_change: [true,true,true,true,true],
  accept_scope_change: [true,true,true,false,false],
  resolve_recovery: [true,true,true,false,false],
  reverse_effect: [true,false,true,false,false],
  manage_connections_roles: [true,false,false,false,false],
  mark_input_received: [true,true,true,true,true],
  read_audit: [true,true,true,false,false],
};
describe('Permission matrix', () => {
  for (const action of Object.keys(expected) as Action[]) {
    roles.forEach((role, index) => it(`${role} ${action}`, () => {
      const member = { ...m, roles: [role] };
      const target = { ...resource, intent: role === 'contributor' ? 'suggest' as const : role === 'client_reviewer' ? 'request' as const : 'propose' as const };
      expect(can(member, action, target)).toBe(expected[action][index]);
      if (expected[action][index]) expect(() => assertCan(member, action, target)).not.toThrow();
      else expect(() => assertCan(member, action, target)).toThrow();
      expect(can(member, action, { ...target, workspace_id: 'other' })).toBe(false);
    }));
  }
});
it('Covers exactly the configured actions', () => expect(Object.keys(expected)).toEqual(Object.keys(matrix)));
it('Combines roles and preserves client company limits for client only members', () => {
  expect(can({ ...m, roles: ['contributor','delivery_lead'] }, 'approve_plan', resource)).toBe(true);
  expect(can({ ...m, roles: ['client_reviewer','admin'] }, 'see_runs', { ...resource, client_company_id: 'other' })).toBe(true);
  for (const action of ['see_runs','mark_input_received','propose_scope_change'] as const) expect(can({ ...m, roles: ['client_reviewer'] }, action, { ...resource, client_company_id: 'other', intent: 'request' })).toBe(false);
});
it('Requires task ownership and item or run ownership where specified', () => {
  expect(can({ ...m, roles: ['contributor'] }, 'see_runs', { ...resource, task_member_ids: [] })).toBe(false);
  for (const role of ['account_manager','delivery_lead'] as const) for (const action of ['read_audit','resolve_recovery'] as const) expect(can({ ...m, roles: [role] }, action, { ...resource, owner_member_id: 'other' })).toBe(false);
});
it('Allows contributor suggestions and client requests without granting proposals', () => {
  for (const role of ['contributor','client_reviewer'] as const) expect(can({ ...m, roles: [role] }, 'propose_scope_change', { ...resource, intent: 'propose' })).toBe(false);
});
it('Refuses every permitted human requester and permits agent drafted requests', () => {
  for (const action of ['approve_plan','approve_client_email','accept_scope_change','reverse_effect'] as const) {
    expect(can({ ...m, roles: ['admin'] }, action, { ...resource, requested_by_type: 'user', requested_by_member_id: m.id })).toBe(false);
    expect(can({ ...m, roles: ['admin'] }, action, { ...resource, requested_by_type: 'agent', requested_by_member_id: m.id })).toBe(true);
  }
});
it('Requires two distinct approvers and the specified role combinations', () => {
  expect(scopeAcceptanceMet([['account_manager'],['delivery_lead']])).toBe(true);
  expect(scopeAcceptanceMet([['admin'],['account_manager']])).toBe(true);
  expect(scopeAcceptanceMet([['delivery_lead'],['admin']])).toBe(true);
  for (const sets of [[], [['admin']], [['account_manager','delivery_lead']], [['admin'],['admin']], [['account_manager'],['account_manager']], [['contributor'],['delivery_lead']]] as const) expect(scopeAcceptanceMet(sets)).toBe(false);
});
