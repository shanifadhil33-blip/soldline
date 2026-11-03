// Browser safe ids and roles mirror the six existing seed personas. Names live in messages.
export const demoPeople = [
  { id: 'faisal', role: 'admin' }, { id: 'omar', role: 'account_manager' },
  { id: 'imran', role: 'delivery_lead' }, { id: 'ravi', role: 'contributor' },
  { id: 'karim', role: 'client_reviewer' }, { id: 'laith', role: 'client_reviewer' },
] as const;
export type DemoPersona = typeof demoPeople[number]['id'];
export function demoHome(persona: DemoPersona) { return persona === 'karim' || persona === 'laith' ? '/home' : '/today'; }
/** Opens a sample workspace as one person. A slow first answer is tried once more instead of leaving the picker stuck. */
export async function startDemo(persona: DemoPersona) {
  let failure: unknown = new Error('Demo unavailable');
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch('/api/demo/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona }), signal: controller.signal });
      if (!response.ok) throw new Error('Demo unavailable');
      const result: unknown = await response.json();
      if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true || !('persona' in result) || result.persona !== persona) throw new Error('Invalid demo response');
      return;
    } catch (error) { failure = error; } finally { clearTimeout(timer); }
  }
  throw failure;
}
