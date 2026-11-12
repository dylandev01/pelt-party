import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomToken, tokenDigest, matchesToken, hashPassword, verifyPassword, parseCookies, constantEqual, cookieKey, roleFromCookies } from '../src/auth.js';

test('tokens are unpredictable and compared using derived digests', () => {
  const t1 = randomToken(), t2 = randomToken();
  assert.notEqual(t1, t2); assert.ok(t1.length >= 42);
  assert.ok(matchesToken(t1, tokenDigest(t1)));
  assert.ok(!matchesToken(t2, tokenDigest(t1)));
  assert.ok(!matchesToken('', tokenDigest(t1)));
});
test('scrypt hashes passwords with unique salts', async () => {
  const a = await hashPassword('this is my password');
  const b = await hashPassword('this is my password');
  assert.notEqual(a, b);
  assert.ok(await verifyPassword('this is my password', a));
  assert.equal(await verifyPassword('wrong password', a), false);
  assert.equal(await verifyPassword('any', 'malformed'), false);
});
test('constant comparison handles nonmatching lengths', () => {
  assert.equal(constantEqual('ab', 'abc'), false); assert.equal(constantEqual('ab', 'ab'), true);
});
test('parses cookies safely and authenticates roles without trusting role hints', () => {
  assert.deepEqual(parseCookies('hello=abc; other=a%20b'), { hello: 'abc', other: 'a b' });
  const room = { id: 'room-x', hostDigest: tokenDigest('host-secret'), viewerDigest: tokenDigest('viewer-secret') };
  assert.equal(roleFromCookies(room, `${cookieKey('viewer', room.id)}=viewer-secret`).role, 'viewer');
  assert.equal(roleFromCookies(room, `${cookieKey('host', room.id)}=host-secret`).role, 'host');
  assert.equal(roleFromCookies(room, 'foo=bar'), null);
});
