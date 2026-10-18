export const day = 86400000;
export type Candidate = { key: string; kind: 'missing_input'|'overdue_client_approval'|'deadline_risk'|'no_owner'|'scope_change_request'|'unusual_instruction'; severity: 'warn'|'block'; title: string; clientFacing: boolean; observedAt: string; quote?: string; memoryIds?:string[] };
export function missingInput(id: string, requested: string|null, blocking: boolean, now: number): Candidate|null {
  const age = requested ? now - Date.parse(requested) : 0;
  return age > 3 * day ? {key:'input:'+id,kind:'missing_input',severity:blocking && age > 7 * day ? 'block':'warn',title:'Client input is still missing',clientFacing:true,observedAt:requested!} : null;
}
export function workingElapsed(start: number, end: number, timezone: string, days = [0,1,2,3,4]): number {
  if(end<=start) return 0;
  const format = new Intl.DateTimeFormat('en-US',{timeZone:timezone,weekday:'short',year:'numeric',month:'2-digit',day:'2-digit'});
  const weekdays=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let total=0;
  for(let cursor=start;cursor<end;) {
    const date=format.format(cursor);
    let next=end;
    if(format.format(end-1)!==date) {
      let low=cursor+1,high=Math.min(end,cursor+36*day/24);
      while(low<high) {const middle=Math.floor((low+high)/2);if(format.format(middle)===date) low=middle+1;else high=middle;}
      next=low;
    }
    const weekday=format.formatToParts(cursor).find(p=>p.type==='weekday')!.value;
    if(days.includes(weekdays.indexOf(weekday))) total+=next-cursor;
    cursor=next;
  }
  return total;
}
export function taskFindings(task:{id:string;status:string;reviewSince:string|null;due:string|null;closed?:boolean},now:number,timezone:string,days?:number[]):Candidate[] {
  if(task.closed) return [];
  const result:Candidate[]=[];
  if(task.status.toLowerCase()==='client review' && task.reviewSince && workingElapsed(Date.parse(task.reviewSince),now,timezone,days)>3*day) result.push({key:'review:'+task.id,kind:'overdue_client_approval',severity:'warn',title:'Client review is taking longer than expected',clientFacing:true,observedAt:task.reviewSince});
  if(task.due && Date.parse(task.due)>=now && Date.parse(task.due)<=now+2*day && task.status.toLowerCase()!=='in progress') result.push({key:'deadline:'+task.id,kind:'deadline_risk',severity:'warn',title:'A task is due soon and has not started',clientFacing:false,observedAt:task.due});
  return result;
}
