import 'server-only';
import { createHash } from 'node:crypto';
import type { TransactionDriver } from './db/withMember';
import { assertCan, ForbiddenError, type Member } from './permissions';
import { append } from './audit';
import { approvalStore } from './approvals/store';
import { cardDraft, draftAccess } from './agent';
import { loadMessages } from '../lib/i18n';
export const tokenHash=(secret:string)=>createHash('sha256').update(secret).digest('hex');
export function agentOwner(owner:TransactionDriver){return {
  async authenticate(secret:string){return owner.transaction(async db=>{
    const token=(await db.query<{id:string;member_id:string;workspace_id:string;requests:number;window_start:string}>("SELECT * FROM mcp_tokens WHERE token_hash=$1 AND revoked_at IS NULL FOR UPDATE",[tokenHash(secret)])).rows[0];
    if(!token)return {status:401 as const};
    const member=(await db.query<Member & Record<string,unknown>>(`SELECT m.*,w.is_demo FROM members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.id=$1 AND m.workspace_id=$2 AND m.archived_at IS NULL AND (NOT coalesce(w.is_demo,false) OR w.demo_expires_at>now())`,[token.member_id,token.workspace_id])).rows[0];
    if(!member)return {status:401 as const};
    const fresh=Date.now()-new Date(token.window_start).getTime()>=60000;
    if(!fresh&&token.requests>=60)return {status:429 as const};
    await db.query('UPDATE mcp_tokens SET window_start=CASE WHEN $2 THEN now() ELSE window_start END,requests=CASE WHEN $2 THEN 1 ELSE requests+1 END WHERE id=$1',[token.id,fresh]);
    return {status:200 as const,member};
  });},
  async card(member:Member,id:string,choice:'yes'|'change',note?:string,guard:typeof assertCan=assertCan){return owner.transaction(async db=>{
    const actor=(await db.query<Member & {language:string} & Record<string,unknown>>(`SELECT m.*,w.is_demo FROM members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.id=$1 AND m.workspace_id=$2 AND m.archived_at IS NULL AND (NOT coalesce(w.is_demo,false) OR w.demo_expires_at>now())`,[member.id,member.workspace_id])).rows[0];
    if(!actor)return {status:404};
    await db.query("SELECT set_config('app.member_id',$1,true)",[actor.id]);
    const c=loadMessages(actor.language==='ar'?'ar':'en').backendA5;
    const card=(await db.query<{id:string;draft:unknown;approval_id:string|null}>('SELECT * FROM agent_cards WHERE id=$1 AND workspace_id=$2 AND member_id=$3 FOR UPDATE',[id,actor.workspace_id,actor.id])).rows[0];
    if(!card)return {status:404};
    if(card.approval_id)return {status:200,approvalId:card.approval_id,message:c.approval};
    const draft=cardDraft.parse(card.draft);
    try{
      await db.query('SET LOCAL ROLE soldline_app');
      if(!await draftAccess(db,actor,draft,guard))return {status:404};
    }catch(error){if(!(error instanceof ForbiddenError))throw error;await append(db,actor.workspace_id,{action:error.action,outcome:'denied',target_id:draft.approval.runId});return {status:403};}
    finally{await db.query('RESET ROLE');}
    if(choice==='change'){
      draft.approval.payload.reviewNote=note??'';
      await db.query('UPDATE agent_cards SET note=$2,draft=$3,revision=revision+1 WHERE id=$1',[id,note??'',JSON.stringify(draft)]);
      await append(db,actor.workspace_id,{action:'agent_card_revised',outcome:'succeeded',target_id:id});
      return {status:200,message:c.revised,draft,note:note??''};
    }
    // Normal approval creation and notifications commit atomically with the card. No decision or execution is called.
    guard(actor,'propose_scope_change',{workspace_id:actor.workspace_id,intent:'propose'});
    const result=await approvalStore({transaction:work=>work(db)}).createApproval({...draft.approval,requestedByType:'agent',requestedByMemberId:actor.id},actor);
    if(result.approval)await db.query('UPDATE agent_cards SET approval_id=$2 WHERE id=$1',[id,result.approval.id]);
    return result;
  });}
};}
