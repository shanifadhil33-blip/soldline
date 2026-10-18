import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
export function equalSecret(value: string, expected: string): boolean {
  const a = Buffer.from(value), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
// HubSpot specifies decoding only these URI escapes before computing its v3 signature.
export function hubspotUri(uri: string) {
  return uri.replace(/%(3A|2F|3F|40|21|24|27|28|29|2A|2C|3B)/gi, value => decodeURIComponent(value));
}
export function verifyHubspot(request: Request, raw: string, secret: string, now = Date.now()) {
  const timestamp = request.headers.get('X-HubSpot-Request-Timestamp') ?? '';
  if (!secret || !/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 300000) return false;
  const expected = createHmac('sha256', secret).update(request.method + hubspotUri(request.url) + raw + timestamp).digest('base64');
  return equalSecret(request.headers.get('X-HubSpot-Signature-v3') ?? '', expected);
}
export function verifyClickup(raw: string, signature: string, secret: string) {
  return !!secret && /^[a-f0-9]{64}$/i.test(signature) && equalSecret(signature.toLowerCase(), createHmac('sha256', secret).update(raw).digest('hex'));
}
