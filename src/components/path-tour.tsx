'use client';
import { useEffect, useState } from 'react';
import { loadMessages, type Language } from '../lib/i18n';

const staffTargets = ['start', 'runs', 'audit'] as const;
const reviewerTargets = ['start', 'home', 'inputs'] as const;

export function PathTour({ locale, reviewer }: { locale: Language; reviewer: boolean }) {
  const m = loadMessages(locale).demo;
  const steps = reviewer ? m.tourReviewer : m.tourStaff;
  const targets = reviewer ? reviewerTargets : staffTargets;
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    document.querySelectorAll('.tour-on').forEach(node => node.classList.remove('tour-on'));
    if (!open) return;
    const visible = [...document.querySelectorAll(`[data-tour="${targets[step]}"]`)].find(node => (node as HTMLElement).getClientRects().length > 0);
    visible?.classList.add('tour-on');
    return () => visible?.classList.remove('tour-on');
  }, [open, step, targets]);
  if (!open) return null;
  const last = step === steps.length - 1;
  return <aside className="tour-card" aria-label={m.guide}>
    <p className="muted">{m.guideStep.replace('{n}', String(step + 1)).replace('{total}', String(steps.length))}</p>
    <p>{steps[step]}</p>
    <div className="tour-actions">
      <button type="button" className="text-button" onClick={() => setOpen(false)}>{m.tourSkip}</button>
      <button type="button" className="button primary" onClick={() => last ? setOpen(false) : setStep(step + 1)}>{last ? m.tourDone : m.tourNext}</button>
    </div>
  </aside>;
}
