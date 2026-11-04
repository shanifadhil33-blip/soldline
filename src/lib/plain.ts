import { demoPeople } from './demo-personas';
import { loadMessages, type Language } from './i18n';
import { formatDate } from './format-date';

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

const phrasePatterns: [RegExp, string][] = [
  [/^No HubSpot line item for (.+)\.$/, 'noLine'],
  [/^No signed scope item for (.+)\.$/, 'noScope'],
  [/^Quantity differs for (.+)\.$/, 'quantity'],
  [/^Cadence differs for (.+)\.$/, 'cadence'],
  [/^No owner for (.+)\.$/, 'noOwner'],
  [/^No (.+) yet\.$/, 'noInput'],
  [/^(.+) not received$/, 'notReceived'],
  [/^Add the (.+) missing line items in HubSpot$/, 'addLines'],
  [/^(.+) asked for changes to (.+)$/, 'changesAsked'],
];

export function demoPhrase(text: string, locale: Language): string {
  if (!text) return text;
  if (locale === 'en') return text;
  const demo = loadMessages(locale).demo;
  const table = demo.phrases as Record<string, string>;
  if (table[text]) return table[text];
  for (const [pattern, key] of phrasePatterns) {
    const match = text.match(pattern);
    if (match && key === 'changesAsked') return (demo.templates as Record<string, string>)[key].replace('{0}', personName(match[1], locale)).replace('{1}', demoPhrase(match[2], locale));
    if (match) return (demo.templates as Record<string, string>)[key].replace('{0}', demoPhrase(match[1], locale));
  }
  return text.split(/(\s*,\s*)/).map(part => table[part] ?? part).join('');
}

/** Names always start with a capital letter. Scripts without capitals are left alone. */
export function capitalise(value: string | null | undefined): string {
  if (!value) return '';
  return value.trim().replace(/(^|[\s'-])(\p{Ll})/gu, (_all, lead: string, letter: string) => lead + letter.toUpperCase());
}

export function statusWord(status: string, locale: Language): string {
  const key = status.toLowerCase().replaceAll(' ', '_').replaceAll('-', '_') as keyof ReturnType<typeof loadMessages>['screens']['statuses'];
  const word = loadMessages(locale).screens.statuses[key] ?? status.replaceAll('_', ' ').replaceAll('-', ' ');
  return word.charAt(0).toLocaleUpperCase(locale) + word.slice(1);
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
    if (Number.isFinite(stamp)) return formatDate(stamp, locale);
  }
  if (field === 'assignees' && Array.isArray(value)) {
    const labels = value.map(item => names[String(item)] ?? '').filter(Boolean);
    return labels.length ? labels.join(', ') : null;
  }
  if (typeof value === 'object') return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value))) return null;
  if (field === 'soldline_run_ref' || field === 'soldline_plan_url') return null;
  const text = String(value);
  if (text.startsWith('@') || text.startsWith('sample_')) return null;
  return demoPhrase(text, locale);
}

export function plainPlace(location: string, locale: Language): string | null {
  if (!location || location.startsWith('@') || location.startsWith('sample_') || /^\d{5,}$/.test(location)) return null;
  if (/^[0-9a-f-]{32,}$/i.test(location)) return null;
  if (location === 'run') return loadMessages(locale).trust.run;
  return demoPhrase(location, locale);
}

export function shouldRunAfterApprove(reversibility: string, message: string): boolean {
  return reversibility !== 'irreversible' && message !== 'Another approval is needed';
}

/** A notification is stored with both languages when it was written by Soldline; older plain text is shown as it is. */
export function noteText(body: string | null | undefined, locale: Language): string {
  if (!body) return '';
  if (!body.startsWith('{')) return body;
  try { const parsed = JSON.parse(body) as { en?: string; ar?: string }; return parsed[locale] ?? parsed.en ?? ''; } catch { return body; }
}
