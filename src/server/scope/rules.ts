import { describe, type Item } from './parser';
export type Evidence = { source:string; quote:string; record_ref:string; rule:string };
export type Finding = { rule:string; severity:'block'|'warn'; title:string; evidence:Evidence[] };
export type Line = { id:string; title:string; sku?:string; quantity?:number; cadence?:Item['cadence'] };
export type Mapping = { title:string; sku?:string; synonyms:string[]; list:string; taskTitle:string; role:string; estimate:number; offset:number };
export const normalise = (s:string) => s.normalize('NFKC').toLowerCase().replace(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|monthly|weekly|once|a month|per month|a week|per week)\b|\d+/g,' ').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
export const scopeEvidence = (i:Item, rule:string):Evidence => ({source:`Signed scope page ${i.page}`,quote:i.quote,record_ref:`page:${i.page}`,rule});
const crmEvidence = (l:Line, rule:string):Evidence => ({source:'HubSpot line items',quote:l.title,record_ref:l.id,rule});
export function match(i:Item, lines:Line[], mappings:Mapping[]) {
  const mapping=mappings.find(m=>[m.title,...m.synonyms].some(t=>normalise(t)===normalise(i.title)));
  const sku=i.sku??mapping?.sku;
  if(sku) { const found=lines.find(l=>l.sku===sku); if(found) return found; }
  const titles=[i.title,...(mapping?[mapping.title,...mapping.synonyms]:[])].map(normalise);
  return lines.find(l=>titles.includes(normalise(l.title)));
}
export function soldNotInCrm(i:Item, line?:Line):Finding[] {
  return line?[]:[{rule:'sold_not_in_crm',severity:'block',title:`No HubSpot line item for ${i.title}.`,evidence:[scopeEvidence(i,'sold_not_in_crm'),{source:'HubSpot line items',quote:'No matching line item',record_ref:'line_items',rule:'sold_not_in_crm'}]}];
}
export function crmNotSold(l:Line, matched:boolean):Finding[] { return matched?[]:[{rule:'crm_not_sold',severity:'warn',title:`No signed scope item for ${l.title}.`,evidence:[crmEvidence(l,'crm_not_sold')]}]; }
export function quantityDiffers(i:Item,l:Line):Finding[] {
  return i.quantity===(l.quantity??describe(l.title).quantity)?[]:[{rule:'quantity_differs',severity:'block',title:`Quantity differs for ${i.title}.`,evidence:[scopeEvidence(i,'quantity_differs'),crmEvidence(l,'quantity_differs')]}];
}
export function cadenceDiffers(i:Item,l:Line):Finding[] {
  return i.cadence===(l.cadence??describe(l.title).cadence)?[]:[{rule:'cadence_differs',severity:'warn',title:`Cadence differs for ${i.title}.`,evidence:[scopeEvidence(i,'cadence_differs'),crmEvidence(l,'cadence_differs')]}];
}
export type Input = { key:string; label:string; required:boolean; blocking:boolean; received:boolean; evidence:Evidence[] };
export function missingInput(i:Input):Finding[] { return !i.required||i.received?[]:[{rule:'missing_input',severity:i.blocking?'block':'warn',title:`No ${i.label} yet.`,evidence:i.evidence.map(e=>({...e,rule:'missing_input'}))}]; }
export function noOwner(title:string, owner:string|null):Finding[] { return owner?[]:[{rule:'no_owner',severity:'block',title:`No owner for ${title}.`,evidence:[{source:'Delivery plan',quote:title,record_ref:'plan',rule:'no_owner'}]}]; }
export function suggestedMatch(item:Item,line:Line) { return { label:'Suggested match',needsPerson:true as const,item, line }; }
