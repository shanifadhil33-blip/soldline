import { renderToStaticMarkup } from 'react-dom/server';
import { expect,it } from 'vitest';
import { ApprovalCard,staleText } from '../src/components/approval-card';
import type { Approval } from '../src/server/approvals/model';
import { loadMessages } from '../src/lib/i18n';
const a={id:'sample',status:'stale',payload:{effects:[{system:'hubspot',location:'deal',action:'patch',records:[{id:'deal',fields:{amount:{before:18000,after:19000}}}],amounts:{AED:19000}}]},reversibility:'reversible',expires_at:'2099-10-18T12:00:00Z',stale_reason:'HubSpot deal changed when checked at Sun, 18 Oct 2026 12:00:00 GMT'} as unknown as Approval;
it('Shows the stored stale reason and refuses all decision buttons',()=>{
  const html=renderToStaticMarkup(<ApprovalCard approval={a} locale="en" onRefresh={async()=>{}}/>);
  expect(html).toContain('Out of date: HubSpot deal changed');
  expect(html).toContain('. Review again.');
  for(const label of ['Approve','Change','Reject'])expect(html).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>${label}</button>`));
  expect(html).not.toContain('Execute approved work');
  expect(html).toContain('18000');expect(html).toContain('19000');
});
it('Keeps the exact stale sentence structure and local observation time',()=>{
  const text=staleText(a.stale_reason as string,'en');
  expect(text).toMatch(/^Out of date: HubSpot deal changed .+\. Review again\.$/);
  expect(text).not.toMatch(/[–—]/);
  expect(staleText(undefined,'en')).toBe('Out of date: The approved inputs changed. Review again.');
});
it('Has complete hand written message keys for both languages',()=>{
  const en=loadMessages('en').screens,ar=loadMessages('ar').screens;
  expect(Object.keys(ar)).toEqual(Object.keys(en));
  expect(ar.approve).toBe('موافقة');
});
it('Shows the full outgoing email and all amount and field values before a decision',()=>{
  const email={...a,status:'pending',reversibility:'irreversible',payload:{effects:[{system:'mail',location:'Team inbox',action:'send',records:[{id:'Karim',fields:{subject:{before:null,after:'Scope confirmation'}}}],amounts:{AED:18000},message:{to:['karim@example.test'],subject:'Scope confirmation',body:'Hello Karim. Please share Meta account access. Thank you, Omar.'}}]}} as Approval;
  const html=renderToStaticMarkup(<ApprovalCard approval={email} locale="en" onRefresh={async()=>{}}/>);
  expect(html).toContain('karim@example.test');expect(html).toContain('Scope confirmation');
  expect(html).toContain('Hello Karim. Please share Meta account access. Thank you, Omar.');
  expect(html).toContain('Cannot be undone');expect(html).toContain('18,000');
});
