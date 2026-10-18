'use client';
import { useState } from 'react';
type Entry={id:string;text:string;scope:string;status:string;count:number;deleted:boolean};
export default function MemoryEntries({entries,language,name}:{entries:Entry[];language:string;name:string|null}) {
  const ar=language==='ar';
  const [items,setItems]=useState(entries),[message,setMessage]=useState(''),[words,setWords]=useState(''),[preferredName,setPreferredName]=useState(name??''),[confirmForget,setConfirmForget]=useState(false);
  async function write(body:unknown) {
    const response=await fetch('/api/memory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!response.ok) {setMessage(ar?'تعذر حفظ الذاكرة':'Memory could not be saved');return;}
    setMessage(ar?'تم حفظ الذاكرة':'Memory saved');
    const refreshed=await fetch('/api/memory');if(refreshed.ok) setItems(await refreshed.json());
  }
  return <><h1>{ar?'الذاكرة':'Memory'}</h1>{name&&<p>{name}</p>}<p>{ar?'اقرأ ما نتذكره وصححه هنا':'Read and correct what is remembered here'}</p>
    <form onSubmit={event=>{event.preventDefault();void write({scope:'person',kind:'preference',text:words,yes:true});setWords('');}}><label>{ar?'ماذا تريد أن أتذكر؟':'What should I remember?'}<textarea required value={words} onChange={event=>setWords(event.target.value)}/></label><p>{ar?'هل أتذكر هذا؟':'Should I remember this?'}</p><button type="submit">{ar?'نعم':'Yes'}</button></form>
    <form onSubmit={event=>{event.preventDefault();void write({scope:'person',kind:'preference',text:ar?'نادني '+preferredName:'Call me '+preferredName,yes:true,personal:{preferredName}});}}><label>{ar?'بأي اسم أناديك؟':'What should I call you?'}<input required value={preferredName} onChange={event=>setPreferredName(event.target.value)}/></label><button type="submit">{ar?'نعم':'Yes'}</button></form>
    <a download="memory.json" href={'data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(items.filter(e=>!e.deleted),null,2))}>{ar?'تصدير':'Export'}</a><p role="status">{message}</p>
    {items.map(e=><article key={e.id}><p>{e.scope==='org'?(ar?'ذاكرة الشركة':'Company wide memory'):(ar?'ذاكرتي':'My memory')}</p>{e.deleted?<p>{ar?'تم حذف الذاكرة':'Memory removed'}</p>:<><p>{e.status==='waiting_approval'?(ar?'بانتظار موافقتك':'Waiting for your approval'):''}</p><label>{ar?'الذاكرة':'Memory'}<textarea key={e.text} defaultValue={e.text} onBlur={event=>{if(event.target.value!==e.text) void write({id:e.id,operation:'edit',text:event.target.value});}}/></label><p>{ar?'عدد السجلات':'Records'} {e.count}</p><button onClick={()=>void write({id:e.id,operation:'delete'})}>{ar?'حذف':'Delete'}</button>{e.scope==='org'&&e.status==='waiting_approval'&&<button onClick={()=>void write({id:e.id,operation:'approve'})}>{ar?'نعم':'Yes'}</button>}</>}<button onClick={()=>void write({id:e.id,operation:'undo'})}>{ar?'تراجع':'Undo'}</button></article>)}
    {confirmForget?<p>{ar?'هل تريد حذف ذاكرتك الشخصية؟':'Clear your personal memory?'}<button onClick={()=>{void write({operation:'forget',yes:true});setConfirmForget(false);}}>{ar?'نعم':'Yes'}</button><button onClick={()=>setConfirmForget(false)}>{ar?'تغيير':'Change'}</button></p>:<button onClick={()=>setConfirmForget(true)}>{ar?'احذف كل ما تتذكره عني':'Forget everything about me'}</button>}
  </>;
}
