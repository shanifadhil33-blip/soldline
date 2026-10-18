// Browser safe ids and roles mirror the six existing seed personas. Names live in messages.
export const demoPeople = [
  { id: 'faisal', role: 'admin' }, { id: 'omar', role: 'account_manager' },
  { id: 'imran', role: 'delivery_lead' }, { id: 'ravi', role: 'contributor' },
  { id: 'karim', role: 'client_reviewer' }, { id: 'laith', role: 'client_reviewer' },
] as const;
export type DemoPersona = typeof demoPeople[number]['id'];
export function demoHome(persona: DemoPersona) { return persona === 'karim' || persona === 'laith' ? '/home' : '/today'; }
export async function startDemo(persona: DemoPersona) {
  const response = await fetch('/api/demo/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona }) });
  if (!response.ok) throw new Error('Demo unavailable');
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true || !('persona' in result) || result.persona !== persona) throw new Error('Invalid demo response');
}
