'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { loadMessages, formatNumber, type Language } from '../lib/i18n';
import { demoPeople, demoHome, startDemo, type DemoPersona } from '../lib/demo-personas';
import { LanguageLink } from './language-link';

import { staffNavigation, navPaths, type NavKey } from '../lib/navigation';

export function AppShell({ children, locale, workspace, name, isDemo, reviewer, persona, recoveryCount = 0 }: {
  children: React.ReactNode; locale: Language; workspace: string; name: string;
  isDemo: boolean; reviewer: boolean; persona?: DemoPersona; recoveryCount?: number;
}) {
  const m = loadMessages(locale); const path = usePathname(); const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  const navigation: readonly NavKey[] = reviewer ? ['home', 'inputs'] : staffNavigation;
  const tabs: readonly NavKey[] = reviewer ? ['home', 'inputs'] : ['today', 'runs', 'queue', 'more'];
  const active = (key: NavKey) => path === navPaths[key] || (key === 'more' && staffNavigation.slice(3).some(item => navPaths[item] === path));
  async function switchPersona(next: DemoPersona) {
    setBusy(true); setError(false);
    try { await startDemo(next); dialog.current?.close(); setConfirming(false); router.replace(demoHome(next)); router.refresh(); }
    catch { setError(true); }
    finally { setBusy(false); }
  }
  function navLink(key: NavKey) {
    return <Link key={key} href={navPaths[key]} aria-current={active(key) ? 'page' : undefined}><span>{m.nav[key]}</span>{(key === 'recovery' || key === 'queue') && recoveryCount > 0 && <span className="count-badge">{formatNumber(recoveryCount, locale)}</span>}</Link>;
  }
  return <div className="app-frame">
    <a className="skip-link" href="#content">{m.common.skip}</a>
    <aside className="app-sidebar"><Link className="brand" href={reviewer ? '/home' : '/today'}>{m.common.brand}</Link><nav aria-label={m.common.navigation}>{navigation.map(navLink)}</nav><span className="sidebar-person">{name}</span></aside>
    <div className="app-column"><header className="app-header"><div className="workspace-heading"><span className="muted">{m.shell.workspace}</span><strong>{workspace}</strong></div><div className="header-actions">
      {isDemo && <><span className="sample-badge">{m.shell.sample}</span><label className="persona-select"><span>{m.shell.persona}</span><select value={persona ?? ''} disabled={busy} onChange={event => void switchPersona(event.target.value as DemoPersona)}>{demoPeople.map(person => <option key={person.id} value={person.id}>{m.demo.people[person.id]}</option>)}</select></label><button className="text-button" disabled={busy} onClick={() => { setError(false); setConfirming(true); dialog.current?.showModal(); }}>{m.shell.reset}</button></>}
      <LanguageLink locale={locale} path={path} />
    </div></header>
    {busy && <p className="shell-status" role="status">{m.shell.loading}</p>}{error && !confirming && <p className="shell-status" role="alert">{m.shell.error}</p>}
    <main className="app-main" id="content" tabIndex={-1}>{children}</main></div>
    <nav className="phone-tabs" aria-label={m.common.navigation}>{tabs.map(navLink)}</nav>
    {isDemo && <dialog ref={dialog} onClose={() => setConfirming(false)} className="reset-dialog" aria-labelledby="reset-title" aria-describedby="reset-body"><h2 id="reset-title">{m.shell.confirmTitle}</h2><p id="reset-body">{m.shell.confirmBody}</p>{error && <p role="alert">{m.shell.error}</p>}<div className="dialog-actions"><button className="button" disabled={busy} onClick={() => dialog.current?.close()}>{m.common.cancel}</button><button className="button primary" disabled={busy} onClick={() => { if (persona) void switchPersona(persona); }}>{m.shell.resetConfirm}</button></div></dialog>}
  </div>;
}
