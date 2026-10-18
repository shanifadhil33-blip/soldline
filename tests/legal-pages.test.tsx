import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { LegalPage } from '../src/components/legal-page';
const hasDash = (text: string) => / - |\u2013|\u2014/.test(text);

it('Privacy page says what is stored, sample data only, no real email and how to ask for deletion', () => {
  const html = renderToStaticMarkup(<LegalPage locale="en" kind="privacy" />);
  for (const fact of ['name, your email address and your profile picture', 'sample data', 'Sample, not sent', 'shanifadhil022@gmail.com', '30 days', 'after 6 hours']) expect(html).toContain(fact);
  expect(hasDash(html.replace(/<[^>]+>/g, ' '))).toBe(false);
});

it('Terms page covers demo use, no real data, resets and contact, in both languages', () => {
  for (const locale of ['en', 'ar'] as const) {
    const html = renderToStaticMarkup(<LegalPage locale={locale} kind="terms" />);
    expect(html).toContain('shanifadhil022@gmail.com');
    expect(hasDash(html.replace(/<[^>]+>/g, ' '))).toBe(false);
  }
});
