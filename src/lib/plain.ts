import { demoPeople } from './demo-personas';
import { loadMessages, type Language } from './i18n';

export function clockFace(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = value instanceof Date ? value.toISOString().slice(11, 16) : String(value);
  const match = text.match(/([01]\d|2[0-3]):([0-5]\d)/);
  return match ? `${match[1]}:${match[2]}` : undefined;
}

export function preparePersonalPatch(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const copy = { ...(body as Record<string, unknown>) };
  if (typeof copy.digestTime === 'string') {
    const face = clockFace(copy.digestTime);
    if (face) copy.digestTime = face;
  }
  return copy;
}

export function demoPhrase(text: string, locale: Language): string {
  if (!text) return text;
  const table = loadMessages(locale).demo.phrases as Record<string, string>;
  return table[text] ?? text;
}

export function personName(value: string | null | undefined, locale: Language): string {
  if (!value) return '';
  const english = loadMessages('en').demo.people;
  const local = loadMessages(locale).demo.people;
  const id = demoPeople.find(person => english[person.id] === value)?.id;
  return id ? local[id] : demoPhrase(value, locale);
}

export function plainValue(field: string, value: unknown, locale: Language, names: Record<string, string> = {}): string | null {
  if (value == null || value === '') return null;
  if (field === 'due_date') {
    const stamp = typeof value === 'number' ? value : typeof value === 'string' && /^\d{12,}$/.test(value) ? Number(value) : Number.NaN;
    if (Number.isFinite(stamp)) return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: 'medium' }).format(new Date(stamp));
  }
  if (field === 'assignees' && Array.isArray(value)) {
    const labels = value.map(item => names[String(item)] ?? '').filter(Boolean);
    return labels.length ? labels.join(', ') : null;
  }
  if (typeof value === 'object') return null;
  if (field === 'soldline_run_ref' || field === 'soldline_plan_url') return null;
  const text = String(value);
  if (text.startsWith('@') || text.startsWith('sample_')) return null;
  return demoPhrase(text, locale);
}

export function plainPlace(location: string, locale: Language): string | null {
  if (!location || location.startsWith('@') || location.startsWith('sample_') || /^\d{5,}$/.test(location)) return null;
  if (/^[0-9a-f-]{32,}$/i.test(location)) return null;
  return demoPhrase(location, locale);
}

export function shouldRunAfterApprove(reversibility: string, message: string): boolean {
  return reversibility !== 'irreversible' && message !== 'Another approval is needed';
}
