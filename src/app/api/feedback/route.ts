import { z } from 'zod';
import { withMemberRoute, fail, answer } from '../../../server/http';
import { assertCan } from '../../../server/permissions';
import { memberCopy, pictureType } from '../../../server/backend-a5';
import { append } from '../../../server/audit';
const input=z.object({message:z.string().trim().min(1).max(2000),pagePath:z.string().max(500).regex(/^\/(?!\/)/).default('/'),appVersion:z.string().max(80).optional(),picture:z.string().max(2796204).optional(),pictureType:z.enum(['image/png','image/jpeg','image/webp']).optional()}).strict();
export const POST=withMemberRoute(async(request,_c,m,db)=>{
 const copy=await memberCopy(db,m);
 let body:unknown;let bytes:Uint8Array|undefined;let declared:string|undefined;
 if(request.headers.get('content-type')?.includes('multipart/form-data')){
   const form=await request.formData().catch(()=>null);if(!form)return fail(400);
   body={message:form.get('message'),pagePath:form.get('pagePath')??'/'};
   const file=form.get('picture');if(file!==null){if(!(file instanceof File)||file.size>2097152)return fail(400,copy.picture);bytes=new Uint8Array(await file.arrayBuffer());declared=file.type;}
 }else body=await request.json().catch(()=>null);
 const parsed=input.safeParse(body);if(!parsed.success)return fail(400,copy.invalid+': '+(parsed.error.issues[0]?.path.join('.')||'message'));
 if(parsed.data.picture!==undefined){if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(parsed.data.picture))return fail(400,copy.picture);bytes=Buffer.from(parsed.data.picture,'base64');declared=parsed.data.pictureType;}
 const type=bytes?pictureType(bytes):null;
 if(bytes&&(!type||bytes.length>2097152||type!==declared)||!bytes&&parsed.data.pictureType)return fail(400,copy.picture);
 const row=(await db.query<{id:string}>('INSERT INTO feedback(workspace_id,member_id,message,page_path,app_version,picture,picture_type) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[m.workspace_id,m.id,parsed.data.message,parsed.data.pagePath,process.env.npm_package_version??'0.1.0',bytes??null,type])).rows[0];
 await append(db,m.workspace_id,{action:'feedback_created',outcome:'succeeded',target_id:row.id});
 return answer(201,copy.feedback);
});
export const GET=withMemberRoute(async(_r,_c,m,db)=>{
 assertCan(m,'manage_connections_roles',{workspace_id:m.workspace_id});
 return Response.json((await db.query('SELECT id,member_id,message,page_path,app_version,picture,picture_type,created_at FROM feedback WHERE workspace_id=$1 ORDER BY created_at DESC,id',[m.workspace_id])).rows);
});
