import type { Member } from './permissions';
/** Agency leads see every open fix in the workspace; a specialist sees only the fixes that are theirs. Today and the Fixes list share this rule so their counts match. */
export function sees(member: Pick<Member, 'roles'>): boolean {
  return member.roles.some(role => role === 'admin' || role === 'account_manager' || role === 'delivery_lead');
}
