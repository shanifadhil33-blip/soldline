'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadMessages, formatNumber, type Language } from '../lib/i18n';
import { demoPeople, demoHome, startDemo, type DemoPersona } from '../lib/demo-personas';
import { capitalise } from '../lib/plain';
import { LanguageLink } from './language-link';
import { AgentChat } from './agent-chat';
import { NotificationBell } from './notification-bell';
import { ToastProvider } from './toast';
import { staffNavigation, staffTabs, reviewerTabs, limitedNavigation, limitedTabs, navPaths, activeTab, activeSidebar, type NavKey } from '../lib/navigation';

export function AppShell({ children, locale, workspace, name, isDemo, reviewer, limited = false, persona, recoveryCount = 0 }: {
  children: React.ReactNode; locale: Language; workspace: string; name: string;
  isDemo: boolean; reviewer: boolean; limited?: boolean; persona?: DemoPersona; recoveryCount?: number;
}) {
  const m = loadMessages(locale); const path = usePathname(); const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const menuRoot = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const [agent, setAgent] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  // The tab the person just pressed shows as active at once, before the next screen has arrived.
  const [pending, setPending] = useState<{ key: NavKey; from: string } | null>(null);
  const navigation: readonly NavKey[] = reviewer ? reviewerTabs : limited ? limitedNavigation : staffNavigation;
  const tabs: readonly NavKey[] = reviewer ? reviewerTabs : limited ? limitedTabs : staffTabs;
  const shownTab = pending && pending.from === path ? pending.key : activeTab(path, reviewer);
  const shownSide = pending && pending.from === path ? activeSidebar(navPaths[pending.key], reviewer) : activeSidebar(path, reviewer);
  const person = capitalise(name);
  const firstName = person.split(' ')[0] ?? person;
  const closeAgent = useCallback(() => setAgent(false), []);
  useEffect(() => {
    const keys = new Set<NavKey>([...tabs, ...navigation, 'feedback']);
    for (const key of keys) router.prefetch(navPaths[key]);
  }, [tabs, navigation, router]);
  useEffect(() => {
    if (!menu) return;
    function outside(event: PointerEvent) { if (!menuRoot.current?.contains(event.target as Node)) setMenu(false); }
    function key(event: KeyboardEvent) { if (event.key === 'Escape') { setMenu(false); menuButton.current?.focus(); } }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); };
  }, [menu]);
  const [seenPath, setSeenPath] = useState(path);
  if (seenPath !== path) { setSeenPath(path); setMenu(false); setAgent(false); setPending(null); }
  async function switchPersona(next: DemoPersona) {
    setBusy(true); setError(false);
    try { await startDemo(next); dialog.current?.close(); setConfirming(false); setMenu(false); router.replace(demoHome(next)); router.refresh(); }
    catch { setError(true); }
    finally { setBusy(false); }
  }
  function navLink(key: NavKey, phone = false) {
    const on = phone ? shownTab === key : shownSide === key;
    return <Link key={key} href={navPaths[key]} prefetch data-tour={key} aria-current={on ? 'page' : undefined}
      onPointerDown={() => setPending({ key, from: path })} onPointerCancel={() => setPending(null)}>
      {phone && <span className="tab-icon-wrap" aria-hidden="true"><TabIcon name={key} /></span>}
      <span className={phone ? 'tab-label' : undefined}>{m.nav[key]}</span>
      {key === 'recovery' && recoveryCount > 0 && <span className="count-badge">{formatNumber(recoveryCount, locale)}</span>}
    </Link>;
  }
  const home = reviewer ? '/home' : '/today';
  async function signOut() {
    setBusy(true);
    try { await fetch('/api/sign-out', { method: 'POST', headers: { Accept: 'application/json' } }); } catch { /* The cookie is cleared by the next visit if this fails. */ }
    window.location.href = '/';
  }
  return <ToastProvider><div className="app-frame">
    <a className="skip-link" href="#content">{m.common.skip}</a>
    <aside className="app-sidebar"><Link className="brand" href={home}>{m.common.brand}</Link><nav aria-label={m.common.navigation}>{navigation.map(key => navLink(key))}</nav><span className="sidebar-person">{person}</span></aside>
    <div className="app-column">
      <header className="app-header">
        <div className="workspace-heading"><strong>{workspace}</strong>{isDemo && <span className="muted">{m.shell.sample}</span>}</div>
        <div className="header-actions">
          <button type="button" className="chip-button agent-open" onClick={() => setAgent(true)}><svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14v9H10l-4 3.5V15H5z" /></svg><span>{m.screens.agent}</span></button>
          <NotificationBell locale={locale} />
          <div className="account" ref={menuRoot}>
            <button type="button" ref={menuButton} className="account-button" aria-haspopup="menu" aria-expanded={menu} aria-label={`${m.shell.account}: ${person}`} onClick={() => setMenu(open => !open)}>
              {persona ? <img src={`/people/${persona}.svg`} alt="" width={32} height={32} /> : <span className="initial" aria-hidden="true">{person.charAt(0)}</span>}
              <span className="account-name">{firstName}</span>
              <svg className="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5" /></svg>
            </button>
            {menu && <div className="account-menu" role="menu" aria-label={m.shell.account}>
              <p className="account-who"><strong>{person}</strong>{isDemo && <span className="muted">{m.shell.sample}</span>}</p>
              {isDemo && <><p className="account-label" id="view-as"><strong>{m.flow.menu.switchPerson}</strong></p>
                <div role="group" aria-labelledby="view-as">{demoPeople.map(item => <button type="button" role="menuitemradio" aria-checked={item.id === persona} disabled={busy} key={item.id} className="menu-row" onClick={() => item.id === persona ? setMenu(false) : void switchPersona(item.id)}>
                  <img src={`/people/${item.id}.svg`} alt="" width={32} height={32} /><span>{m.demo.people[item.id]}</span>{item.id === persona && <svg className="check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
                </button>)}</div></>}
              <div className="menu-divider" />
              <LanguageLink locale={locale} path={path} menu />
              {reviewer && <Link className="menu-row" role="menuitem" href="/settings">{m.nav.settings}</Link>}
              <Link className="menu-row" role="menuitem" href="/feedback">{m.nav.feedback}</Link>
              {isDemo && <button type="button" role="menuitem" className="menu-row" disabled={busy} onClick={() => { setMenu(false); setError(false); setConfirming(true); dialog.current?.showModal(); }}>{m.shell.reset}</button>}
              <button type="button" role="menuitem" className="menu-row strong" disabled={busy} onClick={() => void signOut()}>{m.flow.menu.signOut}</button>
            </div>}
          </div>
        </div>
      </header>
      {busy && <p className="shell-status" role="status">{m.shell.loading}</p>}{error && !confirming && <p className="shell-status" role="alert">{m.shell.error}</p>}
      <main className="app-main" id="content" tabIndex={-1}>{children}</main>
    </div>
    <AgentChat locale={locale} open={agent} onClose={closeAgent} firstName={firstName} />
    <nav className="phone-tabs" aria-label={m.common.navigation}>{tabs.map(key => navLink(key, true))}</nav>
    {isDemo && <dialog ref={dialog} onClose={() => setConfirming(false)} className="reset-dialog" aria-labelledby="reset-title" aria-describedby="reset-body"><h2 id="reset-title">{m.shell.confirmTitle}</h2><p id="reset-body">{m.shell.confirmBody}</p>{error && <p role="alert">{m.shell.error}</p>}<div className="dialog-actions"><button className="button" disabled={busy} onClick={() => dialog.current?.close()}>{m.common.cancel}</button><button className="button primary" disabled={busy} onClick={() => { if (persona) void switchPersona(persona); }}>{m.shell.resetConfirm}</button></div></dialog>}
  </div></ToastProvider>;
}

function TabIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    today: 'M7 4v3M17 4v3M5 7h14v12H5zM9 13l2.2 2.2L15.5 11',
    runs: 'M4 7.5A1.5 1.5 0 015.5 6H10l2 2h6.5A1.5 1.5 0 0120 9.5v8A1.5 1.5 0 0118.5 19h-13A1.5 1.5 0 014 17.5z',
    recovery: 'M14.5 5.5a4 4 0 00-4.9 5.2L4.8 15.5a1.8 1.8 0 002.6 2.6l4.8-4.8a4 4 0 005.2-4.9l-2.6 2.6-2.2-.6-.6-2.2z',
    audit: 'M12 7.5V12l3 2M4.5 12a7.5 7.5 0 107.5-7.5A7.5 7.5 0 006.7 6.7L4.5 9M4.5 4.5V9H9',
    more: 'M6 12h.01M12 12h.01M18 12h.01',
    home: 'M5 11.5L12 5l7 6.5M7.5 10v8.5h9V10',
    inputs: 'M4 13.5L6.2 6h11.6L20 13.5V18H4zM4 13.5h4.5l1 2h5l1-2H20',
  };
  return <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name] ?? paths.more} /></svg>;
}
