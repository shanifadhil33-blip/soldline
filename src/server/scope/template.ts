import { normalise, type Evidence, type Input } from './rules';
export const onboardingTemplate = ['brand guide files','Meta ad account access','Google Ads access','analytics access','name of the client approver','launch date'].map(label=>({key:normalise(label).replaceAll(' ','_'),label,required:true,blocking:false}));
export function templateInputs(records:{key:string;label:string;status:string;evidence:Evidence[]|null}[], template=onboardingTemplate):Input[] {
  return template.map(t=>{
    const record=records.find(r=>r.key===t.key || normalise(r.label??'')===normalise(t.label));
    return {...t,received:record?.status==='received',evidence:record?.evidence?.length?record.evidence:[{source:'Onboarding inputs',quote:`No ${t.label} supplied`,record_ref:record?.key??t.key,rule:'missing_input'}]};
  });
}
