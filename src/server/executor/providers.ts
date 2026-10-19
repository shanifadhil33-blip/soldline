import 'server-only';
import type { TransactionDriver } from '../db/withMember';
import { WorkerConnections } from '../jobs/providers';
import { ClickUpClient } from '../integrations/clickup';
import { HubSpotClient } from '../integrations/hubspot';
import { SampleInboxProvider } from '../integrations/sample-inbox';
import { AgentMailProvider } from '../integrations/mail';
export function executorProviders(owner:TransactionDriver,ws:string,inbox:string,deadline=Date.now()+25000,runId?:string) {
  const connections=new WorkerConnections(owner,ws);
  const options={connections,deadline};
  return {clickup:new ClickUpClient(options),hubspot:new HubSpotClient(options),mail:()=>process.env.MAIL_PROVIDER==='agentmail'?new AgentMailProvider({...options,inbox}):new SampleInboxProvider(owner,ws,runId)};
}
