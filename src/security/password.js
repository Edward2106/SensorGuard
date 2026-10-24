import { randomBytes, scrypt as derive, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(derive);
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
export const digest = value => createHash('sha256').update(value).digest('hex');
export function sameSecret(a, b) {
  return typeof a === 'string' && typeof b === 'string' && !!b && timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
}
export function validPassword(value) { return typeof value === 'string' && value.length >= 16 && Buffer.byteLength(value) <= 256; }
export async function hashPassword(password) {
  if (!validPassword(password)) throw new Error('Password must contain 16–256 bytes (minimum 16 characters)');
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${(await scrypt(password, salt, 64, options)).toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || Buffer.byteLength(password) > 256) return false;
  const [algorithm, salt, key] = String(encoded).split('$');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(key)) return false;
  return timingSafeEqual(await scrypt(password, salt, 64, options), Buffer.from(key, 'hex'));
}
