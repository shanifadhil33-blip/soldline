import 'server-only';
import type { SqlConnection } from './db/withMember';
export async function runMetrics(db:SqlConnection,workspace:string) {
  return (await db.query<{run_id:string;won_to_ready_hours:string|null;oldest_missing_input_days:string|null;commitments_without_owner:number}>('SELECT * FROM run_metrics WHERE workspace_id=$1',[workspace])).rows;
}
