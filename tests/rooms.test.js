import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomStore, RoomError } from '../src/rooms.js';
import { matchesToken } from '../src/auth.js';

test('creates unique authenticated rooms with secure random credentials', async () => {
  const store = new RoomStore();
  const one = await store.create(), two = await store.create();
  assert.notEqual(one.room.id, two.room.id);
  assert.notEqual(one.hostToken, two.hostToken);
  assert.notEqual(one.password, two.password);
  assert.ok(matchesToken(one.hostToken, one.room.hostDigest));
  assert.ok(!one.room.passwordHash.includes(one.password));
  assert.equal(store.get(one.room.id), one.room);
});
test('password authentication, capacity, reconnect and viewer release', async () => {
  const store = new RoomStore(); const { room } = await store.create('this is a strong password');
  await assert.rejects(store.join(room, 'wrong'), e => e.code === 'INVALID_PASSWORD');
  const first = await store.join(room, 'this is a strong password');
  assert.equal(first.returning, false);
  const returning = await store.join(room, '', first.token);
  assert.equal(returning.returning, true);
  assert.equal(returning.token, first.token);
  await assert.rejects(store.join(room, 'this is a strong password'), e => e.code === 'ROOM_FULL');
  const epoch = room.epoch; store.leaveViewer(room);
  assert.notEqual(room.epoch, epoch);
  const next = await store.join(room, 'this is a strong password');
  assert.notEqual(next.token, first.token);
});
test('single-threaded join check prevents competing viewers after password verify', async () => {
  const store = new RoomStore(); const { room, password } = await store.create();
  const results = await Promise.allSettled([store.join(room, password), store.join(room, password)]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(results.filter(x => x.status === 'rejected').length, 1);
});
test('short passwords rejected and invalid room unavailable', async () => {
  const store = new RoomStore();
  await assert.rejects(store.create('x'), e => e.code === 'WEAK_PASSWORD');
  assert.equal(store.get('missing'), null);
});
test('expires idle and absolute ages and cleans references', async () => {
  const store = new RoomStore({ idleMs: 5, maxMs: 50 });
  const { room } = await store.create();
  room.lastActiveAt = Date.now() - 100;
  const ids = []; store.cleanup(r => ids.push(r.id));
  assert.equal(ids.length, 1);
  assert.equal(store.rooms.size, 0);
});
test('active room can outlive idle timeout but not absolute max lifetime', async () => {
  const store = new RoomStore({ idleMs: 500, maxMs: 3000 });
  const { room } = await store.create();
  room.createdAt = Date.now() - 700;
  store.touch(room);
  assert.ok(store.get(room.id));
  room.createdAt = Date.now() - 10_000;
  assert.equal(store.get(room.id), null);
});
test('ending room removes it and invalidates membership', async () => {
  const store = new RoomStore(); const { room } = await store.create();
  store.end(room);
  assert.equal(store.get(room.id), null);
  await assert.rejects(store.join(room, 'password'), e => e.code === 'ROOM_NOT_FOUND');
});
