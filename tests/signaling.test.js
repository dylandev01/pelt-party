import { test } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createApp } from '../src/server.js';
import { config } from '../src/config.js';

const SDP = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000\r\n';
async function harness() {
  const running = createApp(config);
  await new Promise(resolve => running.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${running.server.address().port}`;
  const call = async (path, method = 'GET', body, cookie = '') => {
    const res = await fetch(origin + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] || '' };
  };
  const sockets = [];
  const joinSocket = (roomId, cookie) => new Promise((resolve, reject) => {
    const socket = connect(origin, { transports: ['websocket'], forceNew: true,
      extraHeaders: { Cookie: cookie }, auth: { roomId, instanceId: crypto.randomUUID() }, reconnection: false });
    sockets.push(socket); socket.once('connect', () => resolve(socket)); socket.once('connect_error', reject);
  });
  return { ...running, origin, call, joinSocket, async done() { sockets.forEach(s => s.disconnect()); await running.close(); } };
}
function ack(socket, event, body) { return new Promise(resolve => socket.emit(event, body, resolve)); }
function eventOnce(socket, event) { return new Promise(resolve => socket.once(event, resolve)); }

test('REST authorization, password rejection and third viewer capacity', async () => {
  const h = await harness();
  try {
    const created = await h.call('/api/rooms', 'POST', {});
    assert.equal(created.status, 201);
    const id = created.data.roomId;
    assert.equal((await h.call(`/api/rooms/${id}/status`)).status, 401);
    assert.equal((await h.call(`/api/rooms/${id}/join`, 'POST', { password: 'bad' })).status, 401);
    const joined = await h.call(`/api/rooms/${id}/join`, 'POST', { password: created.data.password });
    assert.equal(joined.status, 200);
    assert.equal((await h.call(`/api/rooms/${id}/join`, 'POST', { password: created.data.password })).status, 409);
    assert.equal((await h.call(`/api/rooms/${id}/status`, 'GET', undefined, joined.cookie)).data.role, 'viewer');
    assert.equal((await h.call(`/api/rooms/${id}`, 'DELETE', undefined, joined.cookie)).status, 403);
    assert.equal((await h.call(`/api/rooms/${id}`, 'DELETE', undefined, created.cookie)).status, 200);
    assert.equal((await h.call(`/api/rooms/${id}/status`, 'GET', undefined, created.cookie)).status, 404);
  } finally { await h.done(); }
});

test('signaling is authorized and role-specific, rejects stale epochs and invalid payloads', async () => {
  const h = await harness();
  try {
    const created = await h.call('/api/rooms', 'POST', {}), id = created.data.roomId;
    const viewer = await h.call(`/api/rooms/${id}/join`, 'POST', { password: created.data.password });
    const hostSocket = await h.joinSocket(id, created.cookie);
    const viewerSocket = await h.joinSocket(id, viewer.cookie);
    const room = h.rooms.get(id); const epoch = room.epoch;
    const negotiationId = crypto.randomUUID();
    const offer = { roomId: id, connectionEpoch: epoch, negotiationId, senderInstanceId: hostSocket.auth.instanceId, messageType: 'offer', payload: { sdp: SDP } };
    const incoming = eventOnce(viewerSocket, 'webrtc:offer');
    assert.equal((await ack(hostSocket, 'webrtc:offer', offer)).ok, true);
    assert.deepEqual(await incoming, offer);
    assert.equal((await ack(hostSocket, 'webrtc:offer', offer)).error, 'DUPLICATE_NEGOTIATION');
    assert.equal((await ack(viewerSocket, 'webrtc:offer', { ...offer, negotiationId: crypto.randomUUID() })).error, 'FORBIDDEN');
    assert.equal((await ack(hostSocket, 'webrtc:offer', { ...offer, connectionEpoch: 'old', negotiationId: crypto.randomUUID() })).ok, false);
    const answer = { ...offer, senderInstanceId: viewerSocket.auth.instanceId, messageType: 'answer' };
    const hostAnswer = eventOnce(hostSocket, 'webrtc:answer');
    assert.equal((await ack(viewerSocket, 'webrtc:answer', answer)).ok, true);
    assert.deepEqual(await hostAnswer, answer);
    assert.equal((await ack(viewerSocket, 'webrtc:answer', answer)).ok, false);
    const invalidCandidate = { ...offer, messageType: 'ice-candidate', payload: { candidate: { candidate: 'x'.repeat(5000) } } };
    assert.equal((await ack(hostSocket, 'webrtc:ice-candidate', invalidCandidate)).ok, false);
    const candidate = { ...offer, messageType: 'ice-candidate', payload: { candidate: null } };
    const received = eventOnce(viewerSocket, 'webrtc:ice-candidate');
    assert.equal((await ack(hostSocket, 'webrtc:ice-candidate', candidate)).ok, true);
    assert.deepEqual(await received, candidate);
    // A reconnect replaces the session and rotates epochs; late signals become invalid.
    const replacement = await h.joinSocket(id, viewer.cookie);
    assert.ok(replacement.connected);
    assert.notEqual(h.rooms.get(id).epoch, epoch);
    assert.equal((await ack(hostSocket, 'webrtc:offer', { ...offer, negotiationId: crypto.randomUUID() })).ok, false);
  } finally { await h.done(); }
});

test('Reconnect stream from either role rotates a shared epoch without kicking either participant', async () => {
  const h = await harness();
  try {
    const created = await h.call('/api/rooms', 'POST', {}), id = created.data.roomId;
    const joined = await h.call(`/api/rooms/${id}/join`, 'POST', { password: created.data.password });
    const host = await h.joinSocket(id, created.cookie);
    const viewer = await h.joinSocket(id, joined.cookie);
    const room = h.rooms.get(id);
    const before = room.epoch;
    room.stream = { active: true, audio: true }; // Browser-owned capture remains independent of connection epoch.
    const hostReset = eventOnce(host, 'peer:reset');
    const viewerReset = eventOnce(viewer, 'peer:reset');
    const rebuilt = await ack(viewer, 'peer:rebuild-request', { connectionEpoch: before });
    assert.equal(rebuilt.ok, true);
    assert.equal(rebuilt.alreadyRecovering, undefined);
    assert.notEqual(room.epoch, before);
    assert.equal((await hostReset).connectionEpoch, room.epoch);
    assert.equal((await viewerReset).connectionEpoch, room.epoch);
    assert.equal(host.connected, true);
    assert.equal(viewer.connected, true);
    assert.equal(room.hostSocketId, host.id);
    assert.equal(room.viewerSocketId, viewer.id);
    assert.deepEqual(room.stream, { active: true, audio: true });
    const duplicate = await ack(host, 'peer:rebuild-request', { connectionEpoch: room.epoch });
    assert.equal(duplicate.ok, true);
    assert.equal(duplicate.alreadyRecovering, true);
    assert.equal(room.epoch, rebuilt.connectionEpoch);
    assert.equal((await ack(host, 'peer:rebuild-request', { connectionEpoch: before })).error, 'STALE_EPOCH');
  } finally { await h.done(); }
});
