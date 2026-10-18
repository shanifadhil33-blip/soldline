'use client';
import Link from 'next/link';
import { useState } from 'react';
import { loadMessages, type Language } from '../lib/i18n';
import { demoPeople, demoHome, startDemo, type DemoPersona } from '../lib/demo-personas';

export function DemoPicker({ locale }: { locale: Language }) {
  const m = loadMessages(locale);
  const [state, setState] = useState<'choose' | 'creating' | 'ready' | 'error'>('choose');
  const [selected, setSelected] = useState<DemoPersona | null>(null);
  async function choose(persona: DemoPersona) {
    setSelected(persona); setState('creating');
    try { await startDemo(persona); setState('ready'); }
    catch { setState('error'); }
  }
  return <>
    <div className="persona-grid" aria-busy={state === 'creating'}>{demoPeople.map(person => <button className="persona-card" key={person.id} disabled={state === 'creating'} aria-pressed={selected === person.id} onClick={() => void choose(person.id)}><strong>{m.demo.people[person.id]}</strong><span>{m.demo.roles[person.role]}</span></button>)}</div>
    <div className="demo-status" role="status" aria-live="polite"><p>{m.demo[state]}</p>{state === 'ready' && selected && <Link className="button primary" href={demoHome(selected)}>{m.demo.open}</Link>}{state === 'error' && selected && <button className="button" onClick={() => void choose(selected)}>{m.common.retry}</button>}</div>
  </>;
}
