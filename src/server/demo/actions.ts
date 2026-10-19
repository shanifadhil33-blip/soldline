'use server';
import { assertCan, ForbiddenError } from '../permissions';
import { loadMessages } from '../../lib/i18n';
import { getLanguage } from '../../lib/locale';
import { cookies } from 'next/headers';
import { getMember } from '../session';
import { getOwnerServices } from '../db/runtime';
import { demoCommands, type DemoCommand } from './controls';
import { z } from 'zod';
/** Next validates the server action origin. The owner service rechecks demo membership. */
export async function runDemoControl(runId:string,command:DemoCommand,count?:number) {
  const member=await getMember(await cookies());
  if(!member)return {status:401,message:'Please sign in or try the demo.'};
  if(!z.uuid().safeParse(runId).success||!demoCommands.includes(command))return {status:400,message:'Choose a demo control'};
  try{
    assertCan(member,'read_audit',{workspace_id:member.workspace_id,owner_member_id:member.id});
    const result=await getOwnerServices().demoControls.run(member,runId,command,count);
    const english=loadMessages('en').backendA4,translated=loadMessages(await getLanguage()).backendA4;
    const key=(Object.keys(english) as Array<keyof typeof english>).find(key=>english[key]===result.message);
    return {...result,message:key?translated[key]:result.message};
  }
  catch(error){if(error instanceof ForbiddenError)return {status:403,message:error.message};return {status:502,message:'A connected service did not answer. Try again in a minute.'};}
}
