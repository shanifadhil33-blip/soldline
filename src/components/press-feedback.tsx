'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

const pressable = 'a[href], button, [role="button"], [role="option"], [role="menuitem"], summary, .pressable';

/** Instant pressed state (pointerdown works on iOS where :active does not) and a top progress bar for screen changes. */
export function PressFeedback() {
  const path = usePathname();
  const [loadingFrom, setLoadingFrom] = useState<string | null>(null);
  const loading = loadingFrom === path;
  const pressed = useRef<Element | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    function clear() {
      pressed.current?.removeAttribute('data-pressed');
      pressed.current = null;
    }
    function down(event: PointerEvent) {
      const target = (event.target as Element | null)?.closest?.(pressable);
      if (!target || (target as HTMLButtonElement).disabled || target.getAttribute('aria-disabled') === 'true') return;
      clear();
      target.setAttribute('data-pressed', 'true');
      pressed.current = target;
      // A finger that never lifts cleanly must not leave a stuck colour.
      setTimeout(() => { if (pressed.current === target) clear(); }, 1500);
    }
    function click(event: MouseEvent) {
      const link = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (link.target && link.target !== '_self') return;
      if (link.hasAttribute('download') || link.origin !== location.origin) return;
      if (link.pathname === location.pathname && link.search === location.search) return;
      setLoadingFrom(location.pathname);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setLoadingFrom(null), 10000);
    }
    document.addEventListener('pointerdown', down, { passive: true });
    for (const name of ['pointerup', 'pointercancel', 'dragstart', 'contextmenu']) document.addEventListener(name, clear, { passive: true });
    window.addEventListener('scroll', clear, { passive: true, capture: true });
    document.addEventListener('click', click);
    return () => {
      document.removeEventListener('pointerdown', down);
      for (const name of ['pointerup', 'pointercancel', 'dragstart', 'contextmenu']) document.removeEventListener(name, clear);
      window.removeEventListener('scroll', clear, true);
      document.removeEventListener('click', click);
      clearTimeout(timer.current);
    };
  }, []);
  return <div className="nav-progress" data-active={loading ? 'true' : undefined} aria-hidden="true" />;
}
