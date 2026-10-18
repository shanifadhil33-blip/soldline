import { expect, it } from 'vitest';
import { asciiDigits, formatNumber, language, loadMessages } from '../src/lib/i18n';
import { demoPeople, demoHome } from '../src/lib/demo-personas';
import { personas } from '../src/server/demo/seed';
import { staffNavigation, navPaths } from '../src/lib/navigation';

it('Uses Western digits for both Arabic digit ranges and localized numbers', () => {
  expect(asciiDigits('٠١٢٣٤٥٦٧٨٩ ۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789 0123456789');
  for (const locale of ['en', 'ar'] as const) {
    expect(formatNumber(1234, locale, { useGrouping: false })).toBe('1234');
    expect(formatNumber(0, locale)).toBe('0');
    expect(formatNumber(12.5, locale)).toBe('12.5');
  }
});

it('Loads matching message shapes with no empty translations', () => {
  function keys(value: unknown, prefix = ''): string[] {
    if (typeof value === 'string') { expect(value.trim().length).toBeGreaterThan(0); return [prefix]; }
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => keys(child, `${prefix}.${key}`));
  }
  expect(keys(loadMessages('ar'))).toEqual(keys(loadMessages('en')));
  expect(language('ar')).toBe('ar');
  expect(language('unknown')).toBe('en');
  for (const key of staffNavigation) {
    expect(loadMessages('ar').nav[key]).not.toBe(loadMessages('en').nav[key]);
    expect(navPaths[key].startsWith('/')).toBe(true);
  }
});

it('Mirrors exactly the six existing personas and their roles', () => {
  expect(demoPeople.map(person => person.id)).toEqual(Object.keys(personas));
  for (const person of demoPeople) {
    expect(person.role).toBe(personas[person.id].role);
    expect(loadMessages('en').demo.people[person.id]).toBe(personas[person.id].name);
    expect(demoHome(person.id)).toBe(person.role === 'client_reviewer' ? '/home' : '/today');
  }
});
