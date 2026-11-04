import { describe, expect, it } from 'vitest';
import { activeTab, activeSidebar } from '../src/lib/navigation';

describe('Active tab follows the real screen', () => {
  it('highlights Projects on a nested project page', () => expect(activeTab('/runs/abc', false)).toBe('runs'));
  it('highlights More for pages reached from More', () => {
    for (const path of ['/more', '/settings', '/team', '/connections', '/templates', '/feedback']) expect(activeTab(path, false)).toBe('more');
  });
  it('gives clients Home for project and deliverable pages', () => {
    expect(activeTab('/deliverables/x', true)).toBe('home');
    expect(activeTab('/inputs', true)).toBe('inputs');
  });
  it('highlights no tab on an unknown page', () => expect(activeTab('/nope', false)).toBeNull());
  it('keeps one sidebar item for Feedback', () => expect(activeSidebar('/feedback', false)).toBe('settings'));
});
