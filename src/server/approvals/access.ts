import { can, type Member } from '../permissions';
import { actions, type Kind } from './model';

export function decisionAllowed(member: Member, approval: { kind: Kind; requested_by_type?: 'user' | 'agent' | null; requested_by_member_id?: string | null }): boolean {
  return can(member, actions[approval.kind], {
    workspace_id: member.workspace_id,
    requested_by_type: approval.requested_by_type ?? undefined,
    requested_by_member_id: approval.requested_by_member_id,
  });
}
