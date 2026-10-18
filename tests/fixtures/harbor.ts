import { readFileSync } from 'node:fs';
import { pdfPages, parse } from '../../src/server/scope/parser';
import type { AnalysisInput } from '../../src/server/scope/engine';
export async function harbor():Promise<AnalysisInput> {
  const pages=await pdfPages(readFileSync('tests/fixtures/harbor-scope.pdf'));
  const titles=parse(pages).map(i=>i.title);
  return {pages,lines:[titles[2],titles[3],titles[4],titles[7]].map((title,i)=>({id:`line${i}`,title})),
    mappings:titles.map((title,i)=>({title,synonyms:[],list:i<2?'Design':'Growth',taskTitle:title,role:'contributor',estimate:60+i*15,offset:i+1})),
    inputs:['brand guide files','Meta ad account access','Google Ads access','analytics access','name of the client approver','launch date'].map((label,i)=>({key:String(i),label,required:true,blocking:false,received:i!==1,evidence:[{source:'Email from Karim Nasser 18 Oct (team inbox)',quote:i===1?'No Meta ad account access yet.':`${label} supplied`,record_ref:'mail:harbor',rule:'missing_input'}]})),
    members:[{id:'ravi',roles:['contributor'],openTasks:2},{id:'bilal',roles:['delivery_lead'],openTasks:0}],start:'2026-10-18',timezone:'Asia/Dubai'};
}
