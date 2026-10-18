import { chain, suggestMatches, type Provider } from '../ai/chain';
import { hash, propose, type Candidate } from '../plan/proposal';
import { grounded, instructions, parse, type Page } from './parser';
import { cadenceDiffers, crmNotSold, match, missingInput, quantityDiffers, soldNotInCrm, type Finding, type Input, type Line, type Mapping } from './rules';
export type AnalysisInput = { pages:Page[]; lines:Line[]; mappings:Mapping[]; inputs:Input[]; members:Candidate[]; start:string; timezone:string };
export async function analyse(input:AnalysisInput, providers?:Record<string,Provider>, matchProviders?:Record<string,Provider>) {
  const parsed=grounded(parse(input.pages),input.pages);
  const fallback=parsed.length?null:await chain(input.pages,providers);
  const items=parsed.length?parsed:fallback!.items;
  const findings:Finding[]=instructions(input.pages).map(i=>({rule:'unusual_instruction',severity:'warn',title:'Unusual instruction in client text.',evidence:[{source:`Signed scope page ${i.page}`,quote:i.quote,record_ref:`page:${i.page}`,rule:'unusual_instruction'}]}));
  const matched=new Set<string>();
  for(const item of items) {
    const line=match(item,input.lines,input.mappings);
    findings.push(...soldNotInCrm(item,line));
    if(line) {matched.add(line.id);findings.push(...quantityDiffers(item,line),...cadenceDiffers(item,line));}
  }
  findings.push(...input.lines.flatMap(l=>crmNotSold(l,matched.has(l.id))),...input.inputs.flatMap(missingInput));
  const plan=propose(items,input.mappings,input.members,input.start,input.timezone);
  findings.push(...plan.findings);
  const missing=items.filter(i=>!match(i,input.lines,input.mappings));
  const suggestions=await suggestMatches(missing,input.lines,matchProviders,matchProviders?Object.keys(matchProviders):undefined);
  const summary=missing.length?`${missing.length} sold deliverables have no line item in HubSpot: ${missing.map(i=>i.title.replace(/^website /i,'').replace(/^email /i,'')).join(', ')}.`:null;
  const messageKey=fallback?.messageKey??suggestions.messageKey??null;
  const proposal={tasks:plan.tasks,summary,messageKey,suggestedMatches:suggestions.matches};
  plan.plan_hash=hash(proposal);
  return {proposal,items,method:parsed.length?'parser' as const:'ai' as const,findings,plan,summary,messageKey,status:!items.length||findings.some(f=>f.severity==='block')?'blocked' as const:'waiting_approval' as const};
}
