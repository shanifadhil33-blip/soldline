'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadMessages, type Language } from '../lib/i18n';
import { demoPeople, startDemo, type DemoPersona } from '../lib/demo-personas';
import { OpenDemo } from './open-demo';

/** Tapping a person opens the workspace as them straight away and lands on the welcome screen. */
export function DemoPicker({ locale }: { locale: Language }) {
  const m = loadMessages(locale);
  const router = useRouter();
  const [state, setState] = useState<'choose' | 'creating' | 'error'>('choose');
  const [selected, setSelected] = useState<DemoPersona | null>(null);
  useEffect(() => { router.prefetch('/welcome'); }, [router]);
  async function choose(persona: DemoPersona) {
    setSelected(persona);
    setState('creating');
    try {
      await startDemo(persona);
      router.push('/welcome');
    } catch {
      setState('error');
    }
  }
  const message = state === 'creating' && selected ? m.demo.openingAs.replace('{name}', m.demo.people[selected]) : state === 'error' ? m.demo.error : m.demo.choose;
  return <>
    {!selected && <OpenDemo locale={locale} />}
    <div className="persona-grid" aria-busy={state === 'creating'}>{demoPeople.map(item => <button className="persona-card" key={item.id} disabled={state === 'creating'} aria-pressed={selected === item.id} data-busy={state === 'creating' && selected === item.id ? 'true' : undefined} onClick={() => void choose(item.id)}><img src={`/people/${item.id}.svg`} alt="" width={56} height={56} /><strong>{m.demo.people[item.id]}</strong><span>{m.demo.roles[item.role]}</span></button>)}</div>
    <div className="demo-status" role="status" aria-live="polite">
      <p>{message}</p>
      {state === 'error' && selected && <button className="button" onClick={() => void choose(selected)}>{m.common.retry}</button>}
    </div>
  </>;
}
