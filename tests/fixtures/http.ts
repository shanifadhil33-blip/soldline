import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

export const server = setupServer(
  http.get('https://fixtures.soldline.test/health', () => HttpResponse.json({ status: 'ready' })),
);
