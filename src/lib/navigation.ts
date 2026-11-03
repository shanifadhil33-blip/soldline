export const staffNavigation = ['today', 'runs', 'recovery', 'audit', 'connections', 'templates', 'team', 'settings'] as const;
export const navPaths = { today: '/today', runs: '/runs', recovery: '/recovery', audit: '/audit-log', connections: '/connections', templates: '/templates', team: '/team', settings: '/settings', feedback: '/feedback', home: '/home', inputs: '/inputs', more: '/more' } as const;
export type NavKey = keyof typeof navPaths;

export const staffTabs = ['today', 'runs', 'recovery', 'audit', 'more'] as const satisfies readonly NavKey[];
export const reviewerTabs = ['home', 'inputs'] as const satisfies readonly NavKey[];
/** Pages reached from the More tab on a phone. */
export const morePages = ['/more', '/connections', '/templates', '/team', '/settings', '/feedback'] as const;

function within(path: string, base: string) { return path === base || path.startsWith(`${base}/`); }

/** The one tab that matches the screen the person is on, including nested pages. */
export function activeTab(path: string, reviewer: boolean): NavKey | null {
  if (reviewer) {
    if (within(path, '/inputs')) return 'inputs';
    if (within(path, '/home') || within(path, '/deliverables') || within(path, '/runs')) return 'home';
    return null;
  }
  if (within(path, '/today')) return 'today';
  if (within(path, '/runs')) return 'runs';
  if (within(path, '/recovery')) return 'recovery';
  if (within(path, '/audit-log')) return 'audit';
  if (morePages.some(page => within(path, page))) return 'more';
  return null;
}

/** The one sidebar item that matches the screen on a laptop. */
export function activeSidebar(path: string, reviewer: boolean): NavKey | null {
  if (reviewer) return activeTab(path, true);
  if (within(path, '/feedback')) return 'settings';
  for (const key of staffNavigation) if (within(path, navPaths[key])) return key;
  return null;
}
