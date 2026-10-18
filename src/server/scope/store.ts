import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { TransactionDriver } from '../db/withMember';
import { systemAudit } from '../jobs/store';
import { hash } from '../plan/proposal';
import { analyse } from './engine';
import { pdfPages } from './parser';
import type { Evidence, Mapping } from './rules';
import { openTaskCounts } from './workload';
import { templateInputs } from './template';
const pageSchema=z.array(z.object({page:z.number().int().positive(),text:z.string()}));
// The driver stays private. Neither method accepts SQL, a table name or a caller supplied workspace record.
export function scopeStore(owner:TransactionDriver) {
  return {
    async saveDocument(ws:string, documentId:string, bytes:Uint8Array) {
      const pages=await pdfPages(bytes);
      return owner.transaction(async db=>{
        const r=await db.query('UPDATE scope_documents SET pages=$3,text=$4,page_count=$5,sha256=$6 WHERE workspace_id=$1 AND id=$2 RETURNING id',[ws,documentId,JSON.stringify(pages),pages.map(p=>p.text).join('\n'),pages.length,createHash('sha256').update(bytes).digest('hex')]);
        if(!r.rows.length) throw new Error('Signed scope not found');
        await systemAudit(db,ws,'system','scope_document_read',documentId);
        return pages;
      });
    },
    async analyseRun(ws:string,runId:string) {
      const data=await owner.transaction(async db=>{
        const rows=await db.query<{deal_id:string;plan_hash:string|null;contract_start_date:string;timezone:string}>(`SELECT r.deal_id,r.plan_hash,d.contract_start_date,w.timezone FROM runs r JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id JOIN workspaces w ON w.id=r.workspace_id WHERE r.workspace_id=$1 AND r.id=$2`,[ws,runId]);
        const run=rows.rows[0];
        if(!run) throw new Error('Run not found');
        const doc=(await db.query<{id:string;pages:unknown}>(`SELECT id,pages FROM scope_documents WHERE workspace_id=$1 AND deal_id=$2 ORDER BY received_at DESC NULLS LAST,id LIMIT 1`,[ws,run.deal_id])).rows[0];
        // P5 can receive a won event before a signed file is available. It remains received until a document is supplied.
        if(!doc?.pages || run.plan_hash) return null;
        const pages=pageSchema.parse(doc.pages);
        const lines=(await db.query<{id:string;title:string;sku:string;quantity:string|null;cadence:'once'|'monthly'|'weekly'|null}>('SELECT id,name AS title,sku,quantity,cadence FROM line_items WHERE workspace_id=$1 AND deal_id=$2 ORDER BY id',[ws,run.deal_id])).rows.map(l=>({...l,sku:l.sku??undefined,title:l.title??'',quantity:l.quantity===null?undefined:Number(l.quantity),cadence:l.cadence??undefined}));
        const mappings=(await db.query<{match_title_normalised:string;match_sku:string;synonyms:string[];template_list:string;task_title:string;default_role:string;estimate_minutes:number;due_offset_days:number;clickup_list_id:string|null}>("SELECT * FROM deliverable_mappings WHERE workspace_id=$1 AND status='active' ORDER BY id",[ws])).rows;
        const inputs=templateInputs((await db.query<{key:string;label:string;status:string;evidence:Evidence[]}>('SELECT key,label,status,evidence FROM onboarding_inputs WHERE workspace_id=$1 AND run_id=$2 ORDER BY id',[ws,runId])).rows);
        const members=(await db.query<{id:string;roles:string[];clickup_user_id:string|null}>('SELECT id,roles,clickup_user_id FROM members WHERE workspace_id=$1 AND archived_at IS NULL ORDER BY id',[ws])).rows;
        return {run,doc,pages,lines,mappings,inputs,members};
      });
      if(!data) return;
      if(!data.run.contract_start_date) throw new Error('Contract start date needs attention');
      if(data.mappings.some(m=>!m.clickup_list_id)) throw new Error('Delivery mapping needs a ClickUp list for workload reads');
      const counts=await openTaskCounts(owner,ws,data.mappings.map(m=>m.clickup_list_id).filter((s):s is string=>!!s));
      const mappings:Mapping[]=data.mappings.map(m=>({title:m.match_title_normalised,sku:m.match_sku,synonyms:m.synonyms,list:m.template_list,taskTitle:m.task_title,role:m.default_role,estimate:m.estimate_minutes,offset:m.due_offset_days}));
      const result=await analyse({pages:data.pages,lines:data.lines,mappings,inputs:data.inputs,members:data.members.filter(m=>!!m.clickup_user_id).map(m=>({...m,openTasks:m.clickup_user_id ? counts[m.clickup_user_id]??0 : Number.MAX_SAFE_INTEGER})),start:data.run.contract_start_date,timezone:data.run.timezone});
      await owner.transaction(async db=>{
        const r=(await db.query<{plan_hash:string|null}>('SELECT plan_hash FROM runs WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[ws,runId])).rows[0];
        if(!r || r.plan_hash) return;
        if(!result.items.length) {
          await db.query("UPDATE runs SET status='blocked',plan=$3 WHERE workspace_id=$1 AND id=$2",[ws,runId,JSON.stringify({tasks:[],messageKey:result.messageKey})]);
          await systemAudit(db,ws,'system','scope_analysis_failed',runId,{messageKey:result.messageKey});
          return;
        }
        await db.query('SELECT id FROM deals WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[ws,data.run.deal_id]);
        const version=(await db.query<{id:string}>(`INSERT INTO scope_versions(workspace_id,deal_id,version,status,source_document_id,items_hash) SELECT $1,$2,coalesce(max(version),0)+1,'draft',$3,$4 FROM scope_versions WHERE workspace_id=$1 AND deal_id=$2 RETURNING id`,[ws,data.run.deal_id,data.doc.id,hash(result.items)])).rows[0].id;
        await systemAudit(db,ws,'system','scope_version_created',version);
        for(const [index,item] of result.items.entries()) {
          await db.query('INSERT INTO scope_items(workspace_id,scope_version_id,key,title,quantity,cadence,source_page,source_quote,method) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[ws,version,String(index+1),item.title,item.quantity,item.cadence,item.page,item.quote,result.method]);
          await systemAudit(db,ws,'system','scope_item_created',version,{key:String(index+1)});
        }
        for(const finding of result.findings) {
          const f=await db.query<{id:string}>("INSERT INTO findings(workspace_id,run_id,kind,severity,title,evidence,status) VALUES($1,$2,$3,$4,$5,$6,'open') RETURNING id",[ws,runId,['missing_input','no_owner','unusual_instruction'].includes(finding.rule)?finding.rule:'scope_mismatch',finding.severity,finding.title,JSON.stringify(finding.evidence)]);
          await systemAudit(db,ws,'system','finding_created',f.rows[0].id,{rule:finding.rule});
        }
        await db.query('UPDATE runs SET scope_version_id=$3,plan=$4,plan_hash=$5,status=$6 WHERE workspace_id=$1 AND id=$2',[ws,runId,version,JSON.stringify(result.proposal),result.plan.plan_hash,result.status]);
        await systemAudit(db,ws,'system','plan_proposed',runId,{plan_hash:result.plan.plan_hash});
      });
      return result;
    },
  };
}
