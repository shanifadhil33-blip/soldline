export const staffNavigation = ['today', 'runs', 'recovery', 'audit', 'connections', 'templates', 'team', 'settings'] as const;
export const navPaths = { today: '/today', runs: '/runs', recovery: '/recovery', audit: '/audit-log', connections: '/connections', templates: '/templates', team: '/team', settings: '/settings', home: '/home', inputs: '/inputs', queue: '/recovery', more: '/more' } as const;
export type NavKey = keyof typeof navPaths;

