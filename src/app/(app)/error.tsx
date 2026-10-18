'use client';
import { useSyncExternalStore } from 'react';
import { language,loadMessages } from '../../lib/i18n';
const subscribe=()=>()=>{};
export default function ErrorPage({reset}:{reset:()=>void}) {
  const locale=useSyncExternalStore(subscribe,()=>language(document.documentElement.lang),()=>language('en'));
  const m=loadMessages(locale).trust;
  return <section className="screen trust-card" role="alert"><h1>{m.error}</h1><button className="button" onClick={reset}>{m.retry}</button></section>;
}
