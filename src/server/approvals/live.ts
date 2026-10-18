import 'server-only';
import { z } from 'zod';
import type { SqlConnection } from '../db/withMember';
import { ProviderRejected } from '../integrations/errors';
import { Connections } from '../integrations/connections';
import { HubSpotClient } from '../integrations/hubspot';
import { Transport, entity, segment } from '../integrations/transport';
import { hash, type InputRef } from './model';
export type LiveRead = (db:SqlConnection,ws:string,memberId:string,ref:InputRef)=>Promise<InputRef>;
// The connection adapter uses the execution transaction, including provider audit and limits.
export const liveRead:LiveRead = async (db,ws,memberId,ref)=>{
  if(ref.system==='scope') {
    await db.query('SELECT id FROM deals WHERE workspace_id=$1 AND id=$2 FOR SHARE',[ws,ref.record_id]);
    const rows=await db.query<{id:string;version:number;items_hash:string|null;status:string}>("SELECT id,version,items_hash,status FROM scope_versions WHERE workspace_id=$1 AND deal_id=$2 ORDER BY version DESC LIMIT 1 FOR SHARE",[ws,ref.record_id]);
    const scope=rows.rows[0];
    return {...ref,version_marker:scope?String(scope.version):'missing',hash:hash(scope??null)};
  }
  const connections=new Connections({transaction:work=>work(db)},ws,memberId);
  const options={connections};
  if(ref.system==='hubspot') {
    const deal=await new HubSpotClient(options).getDeal(ref.record_id);
    if(!deal.properties.hs_lastmodifieddate) throw new Error('Deal modified time is missing');
    return {...ref,version_marker:deal.properties.hs_lastmodifieddate,hash:hash(deal)};
  }
  if(ref.system==='hubspot_line_item') {
    const line=(await new HubSpotClient(options).batchReadLineItems([ref.record_id])).results.find(row=>row.id===ref.record_id);
    return {...ref,version_marker:line?.properties.hs_lastmodifieddate??'missing',hash:hash(line??null)};
  }
  try {
    const list=await new Transport('clickup','https://api.clickup.com',options).request('GET','/api/v2/list/'+segment(ref.record_id),entity.extend({archived:z.boolean().optional()}));
    return {...ref,version_marker:list.archived?'archived':'exists',hash:hash({id:list.id,archived:list.archived??false})};
  } catch(error) {
    if(!(error instanceof ProviderRejected)) throw error;
    return {...ref,version_marker:'missing',hash:hash(null)};
  }
};
