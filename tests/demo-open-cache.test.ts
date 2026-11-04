import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8');

describe('Opening the demo does not reuse screens fetched before sign in', () => {
  it('does not prefetch /welcome before the demo cookie exists', () => {
    expect(read('demo-picker.tsx')).not.toMatch(/prefetch\(/);
  });
  it('clears the router cache before moving to /welcome', () => {
    for (const file of ['demo-picker.tsx', 'open-demo.tsx']) {
      const source = read(file);
      expect(source.indexOf('router.refresh()')).toBeGreaterThan(-1);
      expect(source.indexOf('router.refresh()')).toBeLessThan(source.indexOf("router.push('/welcome')"));
    }
  });
});
