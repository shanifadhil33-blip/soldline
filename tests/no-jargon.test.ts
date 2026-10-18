import { expect, it } from 'vitest';
import { visibleCopy, visibleStrings } from './helpers/source';

export const bannedWords = [
  'dispatch', 'synergy', 'leverage', 'orchestrate', 'workflow automation platform',
  'AI employee', 'copilot', 'assistant',
];

export function hasJargon(value: string): boolean {
  return bannedWords.some((word) => new RegExp(`\\b${word.replaceAll(' ', '\\s+')}\\b`, 'i').test(value));
}

it.each(bannedWords)('Rejects product wording %s', (word) => {
  expect(hasJargon(`Your ${word} is ready`)).toBe(true);
});
it('Allows plain words and skips code identifiers and imports', () => {
  expect(hasJargon('Every deliverable has an owner.')).toBe(false);
  expect(visibleStrings('import assistant from "./assistant"; const dispatch = 1;')).toEqual([]);
  expect(hasJargon('Dispatching')).toBe(false);
});
it('Keeps app and message copy plain', () => {
  expect(visibleCopy().filter(({ value }) => hasJargon(value))).toEqual([]);
});
