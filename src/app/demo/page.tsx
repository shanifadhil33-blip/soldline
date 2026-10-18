'use client';
import Link from 'next/link';
import { useState } from 'react';
// Display names are repeated here so the browser never imports server seed code.
const people = [['faisal', 'Faisal Rahman'], ['omar', 'Omar Haddad'], ['imran', 'Imran Shaikh'], ['ravi', 'Ravi Menon'], ['karim', 'Karim Nasser'], ['laith', 'Laith Saeed']];
export default function DemoPage() {
  const [message, setMessage] = useState('Choose a persona to start.');
  const [busy, setBusy] = useState(false);
  return <main className="mx-auto max-w-xl p-6">
    <h1 className="text-2xl font-semibold">Soldline demo</h1>
    <p className="mt-4">Sample data</p>
    <p>Northlight Studio, Harbor Coffee Roasters and Cedar Line Furniture are fictional.</p>
    <div className="mt-6 flex flex-wrap gap-3">{people.map(([persona, name]) => <button key={persona} disabled={busy} className="rounded-sm border border-structure px-4 py-3" onClick={async () => {
      setBusy(true);
      try {
        const response = await fetch('/api/demo/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona }) });
        setMessage(response.ok ? `Welcome, ${name}. Your demo is ready.` : 'We could not start the demo. Please try again.');
      } catch { setMessage('We could not start the demo. Please try again.'); }
      finally { setBusy(false); }
    }}>{name}</button>)}</div>
    <p className="mt-4" role="status">{message}</p>
    <Link className="mt-4 block underline" href="/sign-in">Sign in</Link>
  </main>;
}
