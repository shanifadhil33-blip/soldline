'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadMessages, type Language } from '../lib/i18n';
import { demoPeople, startDemo, type DemoPersona } from '../lib/demo-personas';
import { OpenDemo } from './open-demo';

export function DemoPicker({ locale }: { locale: Language }) {
  const m = loadMessages(locale);
  const router = useRouter();
  const [state, setState] = useState<'choose' | 'creating' | 'ready' | 'error'>('choose');
  const [selected, setSelected] = useState<DemoPersona | null>(null);
  async function choose(persona: DemoPersona) {
    setSelected(persona);
    setState('creating');
    try {
      await startDemo(persona);
      setState('ready');
      router.push('/welcome');
    } catch {
      setState('error');
    }
  }
  const person = demoPeople.find(item => item.id === selected);
  const reviewer = person?.role === 'client_reviewer';
  const steps = reviewer ? m.demo.stepsReviewer : m.demo.stepsStaff;
  return <>
    <OpenDemo locale={locale} />
    <div className="persona-grid" aria-busy={state === 'creating'}>{demoPeople.map(item => <button className="persona-card" key={item.id} disabled={state === 'creating'} aria-pressed={selected === item.id} onClick={() => void choose(item.id)}><img src={`/people/${item.id}.svg`} alt="" width={56} height={56} /><strong>{m.demo.people[item.id]}</strong><span>{m.demo.roles[item.role]}</span></button>)}</div>
    <div className="demo-status" role="status" aria-live="polite">
      <p>{m.demo[state]}</p>
      {selected && person && <article className="welcome-card">
        <p className="muted">{m.demo.roles[person.role]}</p>
        <h2>{m.demo.hello.replace('{name}', m.demo.people[selected])}</h2>
        <p>{reviewer ? m.demo.welcomeReviewer : m.demo.welcomeStaff}</p>
        <ol className="welcome-steps">{steps.map((step, index) => <li key={step}><span>{index + 1}</span><p>{step}</p></li>)}</ol>
        <button className="button primary welcome-go" type="button" disabled>{state === 'error' ? m.demo.error : m.demo.opening}</button>
      </article>}
      {!selected && <p>{m.demo[state]}</p>}
      {state === 'error' && selected && <button className="button" onClick={() => void choose(selected)}>{m.common.retry}</button>}
    </div>
  </>;
}
