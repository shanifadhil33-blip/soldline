import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
function key(value = process.env.TOKEN_ENC_KEY ?? '') {
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 32 || decoded.toString('base64') !== value) throw new Error('Token encryption key must be 32 bytes in base64');
  return decoded;
}
export function encryptToken(token: string, secret?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}
export function decryptToken(value: string, secret?: string): string {
  try {
    const [version, iv, tag, data, ...rest] = value.split(':');
    if (version !== 'v1' || rest.length || !iv || !tag || data === undefined || Buffer.from(iv, 'base64').length !== 12 || Buffer.from(tag, 'base64').length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key(secret), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch { throw new Error('Stored token could not be opened'); }
}
