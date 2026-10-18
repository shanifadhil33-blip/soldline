import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/recovery', useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
import { AppShell } from '../src/components/app-shell';
import { loadMessages } from '../src/lib/i18n';

it('Shows a localized Recovery badge only for a positive count', () => {
  const props = { locale: 'ar' as const, workspace: 'Northlight Studio', name: 'فيصل رحمن', isDemo: true, reviewer: false, persona: 'faisal' as const };
  const empty = renderToStaticMarkup(<AppShell {...props}>Soldline</AppShell>);
  expect(empty).not.toContain('count-badge');
  const recovery = renderToStaticMarkup(<AppShell {...props} recoveryCount={12}>Soldline</AppShell>);
  expect(recovery.match(/class="count-badge">12</g)).toHaveLength(2);
  expect(recovery).toContain(loadMessages('ar').nav.recovery);
  expect(recovery).not.toContain('Recovery');
  expect(recovery).not.toContain('Reset demo');
});

it('Gives client reviewers only Home and Inputs in both navigation areas', () => {
  const html = renderToStaticMarkup(<AppShell locale="en" workspace="Northlight Studio" name="Karim Nasser" isDemo reviewer persona="karim">Soldline</AppShell>);
  expect(html.match(/href="\/inputs"/g)).toHaveLength(2);
  expect(html).not.toContain('href="/runs"');
  expect(html).not.toContain('href="/settings"');
});
