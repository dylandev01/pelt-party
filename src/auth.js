import { randomBytes, createHmac, timingSafeEqual, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
// The production config validates SESSION_SECRET; the process uses one ephemeral key in local tests.
const SESSION_PEPPER = process.env.SESSION_SECRET || randomBytes(32).toString('hex');

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const tokenDigest = token => createHmac('sha256', SESSION_PEPPER).update(token).digest('hex');
export function constantEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a, 'utf8'), right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
export const matchesToken = (plain, digest) => constantEqual(tokenDigest(plain || ''), digest || '');
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || !stored) return false;
  const [salt, saved] = stored.split(':');
  if (!/^[0-9a-f]{32}$/.test(salt || '') || !/^[0-9a-f]{128}$/.test(saved || '')) return false;
  const actual = await scrypt(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(saved, 'hex'));
}
export function parseCookies(header = '') {
  const result = {};
  for (const fragment of header.split(';')) {
    const i = fragment.indexOf('=');
    if (i <= 0) continue;
    try { result[fragment.slice(0, i).trim()] = decodeURIComponent(fragment.slice(i + 1).trim()); } catch { /* discard */ }
  }
  return result;
}
export const cookieKey = (role, roomId) => `pc_${role}_${roomId}`;
export function cookieSettings({ production, maxAge }, clear = false) {
  return { httpOnly: true, secure: production, sameSite: 'strict', path: '/', maxAge: clear ? 0 : maxAge };
}
export function roleFromCookies(room, cookieHeader) {
  const cookies = parseCookies(cookieHeader);
  if (matchesToken(cookies[cookieKey('host', room.id)], room.hostDigest)) return { role: 'host', token: cookies[cookieKey('host', room.id)] };
  if (room.viewerDigest && matchesToken(cookies[cookieKey('viewer', room.id)], room.viewerDigest)) return { role: 'viewer', token: cookies[cookieKey('viewer', room.id)] };
  return null;
}
