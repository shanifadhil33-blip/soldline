import { expect, it } from 'vitest';

it('Uses an HTTP fixture without a live service', async () => {
  const response = await fetch('https://fixtures.soldline.test/health');
  expect(await response.json()).toEqual({ status: 'ready' });
});
