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
  const tabs: readonly NavKey[] = reviewer ? ['home', 'inputs'] : ['runs', 'recovery', 'needs', 'audit', 'more'];
  const active = (key: NavKey) => key === 'needs' ? path === '/today' : path === navPaths[key] || (key === 'runs' && path.startsWith('/runs/')) || (key === 'more' && staffNavigation.slice(3).some(item => navPaths[item] === path));
  async function switchPersona(next: DemoPersona) {
    setBusy(true); setError(false);
    try { await startDemo(next); dialog.current?.close(); setConfirming(false); router.replace(demoHome(next)); router.refresh(); }
    catch { setError(true); }
    finally { setBusy(false); }
  }
  function navLink(key: NavKey, phone = false) {
    return <Link key={key} href={navPaths[key]} className={phone && key === 'needs' ? 'phone-raise' : undefined} aria-current={active(key) ? 'page' : undefined}>{phone && <TabIcon name={key} />}{phone && key === 'needs' && <span className="tab-dot" aria-hidden="true" />}<span>{m.nav[key]}</span>{(key === 'recovery' || key === 'queue') && recoveryCount > 0 && <span className="count-badge">{formatNumber(recoveryCount, locale)}</span>}</Link>;
  }
  return <div className="app-frame">
    <a className="skip-link" href="#content">{m.common.skip}</a>
    <aside className="app-sidebar"><Link className="brand" href={reviewer ? '/home' : '/today'}>{m.common.brand}</Link><nav aria-label={m.common.navigation}>{navigation.map(key => navLink(key))}</nav><span className="sidebar-person">{name}</span></aside>
    <div className="app-column"><header className="app-header"><div className="workspace-heading"><span className="muted">{m.shell.workspace}</span><strong>{workspace}</strong></div><div className="header-actions">
      {isDemo && <><span className="sample-badge">{m.shell.sample}</span><label className="persona-select"><span>{m.shell.persona}</span><select value={persona ?? ''} disabled={busy} onChange={event => void switchPersona(event.target.value as DemoPersona)}>{demoPeople.map(person => <option key={person.id} value={person.id}>{m.demo.people[person.id]}</option>)}</select></label><button className="text-button" disabled={busy} onClick={() => { setError(false); setConfirming(true); dialog.current?.showModal(); }}>{m.shell.reset}</button></>}
      <LanguageLink locale={locale} path={path} />
    </div></header>
    {busy && <p className="shell-status" role="status">{m.shell.loading}</p>}{error && !confirming && <p className="shell-status" role="alert">{m.shell.error}</p>}
    <main className="app-main" id="content" tabIndex={-1}>{children}</main></div>
    <nav className="phone-tabs" aria-label={m.common.navigation}>{tabs.map(key => navLink(key, true))}</nav>
    {isDemo && <dialog ref={dialog} onClose={() => setConfirming(false)} className="reset-dialog" aria-labelledby="reset-title" aria-describedby="reset-body"><h2 id="reset-title">{m.shell.confirmTitle}</h2><p id="reset-body">{m.shell.confirmBody}</p>{error && <p role="alert">{m.shell.error}</p>}<div className="dialog-actions"><button className="button" disabled={busy} onClick={() => dialog.current?.close()}>{m.common.cancel}</button><button className="button primary" disabled={busy} onClick={() => { if (persona) void switchPersona(persona); }}>{m.shell.resetConfirm}</button></div></dialog>}
  </div>;
}

function TabIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    runs: 'M6 8h12M6 12h12M6 16h8',
    recovery: 'M12 6v6l4 2',
    needs: 'M12 7a5 5 0 0 1 5 5c0 3-5 6-5 6s-5-3-5-6a5 5 0 0 1 5-5z',
    audit: 'M7 6h10v12H7zM9 10h6M9 14h4',
    more: 'M6 12h.01M12 12h.01M18 12h.01',
    home: 'M5 12l7-7 7 7M8 11v7h8v-7',
    inputs: 'M7 7h10v10H7zM9 11h6',
  };
  return <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name] ?? paths.more} /></svg>;
}
