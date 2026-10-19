import 'server-only';
import { loadMessages } from '../../lib/i18n';
const copy=loadMessages('en').backendA4;
import { randomUUID } from 'node:crypto';
import type { SqlConnection, TransactionDriver } from '../db/withMember';
import type { DraftInput, MailMessage, MailProvider, SentSearch } from './mail';
import { NeedsReconnect } from './errors';
import { systemAudit } from '../jobs/store';
export const sampleMailStatus=copy.sampleNotSent;
type Row={id:string;raw:MailMessage;message_id:string;thread_id:string};
/** A database inbox. It has no transport, credential, or network dependency. */
export class SampleInboxProvider implements MailProvider {
  constructor(private readonly owner:TransactionDriver,private readonly ws:string,private readonly runId?:string) {}
  private async operation<T>(work:(db:SqlConnection)=>Promise<T>) {
    return this.owner.transaction(async db=>{
      const connection=(await db.query<{status:string}>("SELECT status FROM connections WHERE workspace_id=$1 AND provider='mail'",[this.ws])).rows[0];
      if(connection&&connection.status!=='connected')throw new NeedsReconnect();
      return work(db);
    });
  }
  async getInbox(){return this.operation(async()=>({inbox_id:'sample:'+this.ws,display_name:copy.sampleInbox}));}
  async listMessagesSince(cursor:string){return this.operation(async db=>({messages:(await db.query<Row>("SELECT raw FROM sample_mail WHERE workspace_id=$1 AND direction='inbound' AND (raw->>'timestamp')::timestamptz>$2::timestamptz ORDER BY created_at,id",[this.ws,cursor||new Date(0).toISOString()])).rows.map(r=>r.raw)}));}
  async getMessage(id:string){return this.operation(async db=>{
    const row=(await db.query<Row>('SELECT raw FROM sample_mail WHERE workspace_id=$1 AND message_id=$2',[this.ws,id])).rows[0];
    if(!row)throw new Error('Sample message not found');return row.raw;
  });}
  async getThread(id:string){return this.operation(async db=>({thread_id:id,messages:(await db.query<Row>('SELECT raw FROM sample_mail WHERE workspace_id=$1 AND thread_id=$2 ORDER BY created_at,id',[this.ws,id])).rows.map(r=>r.raw)}));}
  async createDraft(input:DraftInput){return this.operation(async db=>{
    const run=this.runId??(await db.query<{id:string}>('SELECT id FROM runs WHERE workspace_id=$1 ORDER BY id LIMIT 1',[this.ws])).rows[0]?.id;
    if(!run)throw new Error('Sample run not found');
    const id=randomUUID(),messageId=input.messageId??id;
    const raw={message_id:messageId,thread_id:input.replyToMessageId??'draft:'+id,to:input.to,subject:input.subject,text:input.text,status:sampleMailStatus,sample:true};
    const row=(await db.query<{id:string}>(`INSERT INTO sample_mail(id,workspace_id,run_id,direction,message_id,thread_id,raw,status) VALUES($1,$2,$3,'outbound',$4,$5,$6,$7) ON CONFLICT(workspace_id,message_id) DO UPDATE SET message_id=excluded.message_id RETURNING id`,[id,this.ws,run,messageId,raw.thread_id,JSON.stringify(raw),sampleMailStatus])).rows[0];
    await systemAudit(db,this.ws,'system','sample_draft_created',row.id,{status:sampleMailStatus});
    return {draft_id:row.id,status:sampleMailStatus};
  });}
  async sendDraft(id:string){return this.operation(async db=>{
    const row=(await db.query<Row>(`UPDATE sample_mail SET status=$3,raw=raw||jsonb_build_object('status',$3::text,'sample_sent',true,'timestamp',now()) WHERE workspace_id=$1 AND id=$2 AND direction='outbound' RETURNING *`,[this.ws,id,sampleMailStatus])).rows[0];
    if(!row)throw new Error('Sample draft not found');
    await systemAudit(db,this.ws,'system','sample_mail_not_sent',row.id,{status:sampleMailStatus});return row.raw;
  });}
  async searchSent(input:SentSearch){return this.operation(async db=>({messages:(await db.query<Row>(`SELECT raw FROM sample_mail WHERE workspace_id=$1 AND direction='outbound' AND raw->>'sample_sent'='true' AND ($2::text IS NULL OR message_id=$2) AND raw->>'subject'=$3`,[this.ws,input.messageId??null,input.subject])).rows.map(r=>r.raw)}));}
}
export async function seedSampleInbox(db:SqlConnection,ws:string) {
  const runs=(await db.query<{id:string;name:string}>(`SELECT r.id,d.name FROM runs r JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id WHERE r.workspace_id=$1 AND (d.name LIKE 'Harbor%' OR d.name LIKE 'Cedar%') ORDER BY d.name`,[ws])).rows;
  for(const run of runs){
    const harbor=run.name.startsWith('Harbor');const thread='sample_thread:'+run.id;
    await db.query("UPDATE runs SET plus_address=$3,mail_thread_ids=array_append(mail_thread_ids,$4) WHERE workspace_id=$1 AND id=$2 AND NOT ($4=ANY(mail_thread_ids))",[ws,run.id,'sample+'+run.id+'@soldline.example',thread]);
    const texts=harbor?[copy.scopeEmail,copy.karimReply]:[copy.laithReply];
    for(const [index,text] of texts.entries()){
      const messageId=thread+':'+index;
      const raw={message_id:messageId,thread_id:thread,to:['sample+'+run.id+'@soldline.example'],from:harbor?'karim@harbor.example':'laith@cedar.example',subject:copy.sampleEmail,text,timestamp:new Date().toISOString(),sample:true};
      await db.query(`INSERT INTO sample_mail(workspace_id,run_id,direction,message_id,thread_id,raw) VALUES($1,$2,'inbound',$3,$4,$5) ON CONFLICT DO NOTHING`,[ws,run.id,messageId,thread,JSON.stringify(raw)]);
    }
  }
  await db.query(`INSERT INTO connections(workspace_id,provider,status,external_account_id) VALUES($1,'mail','connected',$2) ON CONFLICT DO NOTHING`,[ws,'sample:'+ws]);
}
