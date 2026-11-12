import { randomUUID } from 'node:crypto';
import { roleFromCookies } from './auth.js';

const ok = data => ({ ok: true, ...data });
const fail = code => ({ ok: false, error: code });
const validId = value => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);
const MAX_SDP = 100_000;

export function attachSignaling(io, store, { disconnectGraceMs = 15_000 } = {}) {
  const graceTimers = new Map();
  const connections = new Map(); // per-socket per-event limits, not media traffic
  const sendPeer = (room, role, event, data) => {
    const target = role === 'host' ? room.viewerSocketId : room.hostSocketId;
    if (target) io.to(target).emit(event, data);
  };
  const presence = room => ({ hostConnected: Boolean(room.hostSocketId), viewerConnected: Boolean(room.viewerSocketId),
    stream: { ...room.stream }, streamRevision: room.streamRevision });
  const publishPresence = room => {
    for (const id of [room.hostSocketId, room.viewerSocketId]) if (id) io.to(id).emit('room:presence', presence(room));
  };
  const resetPeers = room => {
    for (const id of [room.hostSocketId, room.viewerSocketId]) if (id) io.to(id).emit('peer:reset', { connectionEpoch: room.epoch });
    if (room.hostSocketId && room.viewerSocketId) {
      io.to(room.hostSocketId).emit('peer:ready', { connectionEpoch: room.epoch });
      io.to(room.viewerSocketId).emit('peer:ready', { connectionEpoch: room.epoch });
    }
  };
  const endRoom = room => {
    for (const role of ['host', 'viewer']) {
      const key = `${room.id}:${role}`; clearTimeout(graceTimers.get(key)); graceTimers.delete(key);
    }
    for (const id of [room.hostSocketId, room.viewerSocketId]) if (id) {
      io.to(id).emit('room:ended'); io.sockets.sockets.get(id)?.disconnect(true);
    }
    store.end(room);
  };
  io.use((socket, next) => {
    const roomId = socket.handshake.auth?.roomId;
    if (!validId(roomId)) return next(new Error('INVALID_ROOM'));
    const room = store.get(roomId);
    if (!room) return next(new Error('ROOM_NOT_FOUND'));
    const identity = roleFromCookies(room, socket.handshake.headers.cookie);
    if (!identity) return next(new Error('UNAUTHORIZED'));
    socket.data.roomId = roomId;
    socket.data.role = identity.role;
    socket.data.instanceId = validId(socket.handshake.auth?.instanceId) ? socket.handshake.auth.instanceId : randomUUID();
    next();
  });
  io.on('connection', socket => {
    const room = store.get(socket.data.roomId);
    if (!room) { socket.disconnect(true); return; }
    const role = socket.data.role;
    const graceKey = `${room.id}:${role}`;
    clearTimeout(graceTimers.get(graceKey)); graceTimers.delete(graceKey);
    const key = role === 'host' ? 'hostSocketId' : 'viewerSocketId';
    const instanceKey = role === 'host' ? 'hostInstance' : 'viewerInstance';
    const prior = room[key];
    room[key] = socket.id; room[instanceKey] = socket.data.instanceId;
    if (prior && prior !== socket.id) io.sockets.sockets.get(prior)?.disconnect(true);
    store.touch(room);
    if (room.hostSocketId && room.viewerSocketId) store.rotateEpoch(room);
    socket.emit('room:ready', { role, roomId: room.id, connectionEpoch: room.epoch, ...presence(room) });
    publishPresence(room);
    resetPeers(room);
    const clock = () => Date.now();
    connections.set(socket.id, { start: clock(), count: 0 });
    const allow = (event, payload, ack, callback) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const current = store.get(socket.data.roomId);
      if (!current || current[key] !== socket.id) return reply(fail('STALE_SESSION'));
      const limit = connections.get(socket.id);
      if (!limit) return reply(fail('DISCONNECTED'));
      if (clock() - limit.start > 10_000) { limit.start = clock(); limit.count = 0; }
      limit.count += 1;
      if (limit.count > 200) return reply(fail('RATE_LIMITED'));
      try { callback(current, payload, reply); } catch { reply(fail('INVALID_MESSAGE')); }
    };
    socket.on('room:activity', (payload, ack) => allow('room:activity', payload, ack, (r, _p, reply) => {
      store.touch(r); reply(ok({}));
    }));
    socket.on('stream:state', (payload, ack) => allow('stream:state', payload, ack, (r, p, reply) => {
      if (role !== 'host') return reply(fail('FORBIDDEN'));
      if (!p || typeof p.active !== 'boolean' || typeof p.audio !== 'boolean' || (p.audio && !p.active)) return reply(fail('INVALID_MESSAGE'));
      r.streamRevision++;
      r.stream = { active: p.active, audio: p.audio };
      store.touch(r);
      for (const id of [r.hostSocketId, r.viewerSocketId]) if (id) io.to(id).emit('stream:state', { ...r.stream, streamRevision: r.streamRevision });
      reply(ok({ streamRevision: r.streamRevision }));
    }));
    socket.on('webrtc:offer', (payload, ack) => allow('webrtc:offer', payload, ack, (r, p, reply) => {
      if (role !== 'host') return reply(fail('FORBIDDEN'));
      if (!validateEnvelope(r, p, 'offer', socket.data.instanceId) || !p.payload || !validSdp(p.payload.sdp, 'offer')) return reply(fail('INVALID_MESSAGE'));
      if (!r.viewerSocketId) return reply(fail('PEER_OFFLINE'));
      if (p.negotiationId === r.negotiationId) return reply(fail('DUPLICATE_NEGOTIATION'));
      r.negotiationId = p.negotiationId; r.negotiationAnswered = false;
      store.touch(r); sendPeer(r, role, 'webrtc:offer', p); reply(ok({}));
    }));
    socket.on('webrtc:answer', (payload, ack) => allow('webrtc:answer', payload, ack, (r, p, reply) => {
      if (role !== 'viewer') return reply(fail('FORBIDDEN'));
      if (!validateEnvelope(r, p, 'answer', socket.data.instanceId) || p.negotiationId !== r.negotiationId || r.negotiationAnswered || !validSdp(p.payload?.sdp, 'answer')) return reply(fail('STALE_OR_INVALID_ANSWER'));
      if (!r.hostSocketId) return reply(fail('PEER_OFFLINE'));
      r.negotiationAnswered = true; store.touch(r); sendPeer(r, role, 'webrtc:answer', p); reply(ok({}));
    }));
    socket.on('webrtc:ice-candidate', (payload, ack) => allow('webrtc:ice-candidate', payload, ack, (r, p, reply) => {
      if (!validateEnvelope(r, p, 'ice-candidate', socket.data.instanceId) || p.negotiationId !== r.negotiationId || !validCandidate(p.payload?.candidate)) return reply(fail('STALE_OR_INVALID_CANDIDATE'));
      if (!(role === 'host' ? r.viewerSocketId : r.hostSocketId)) return reply(fail('PEER_OFFLINE'));
      sendPeer(r, role, 'webrtc:ice-candidate', p); reply(ok({}));
    }));
    socket.on('peer:rebuild-request', (payload, ack) => allow('peer:rebuild-request', payload, ack, (r, p, reply) => {
      if (!p || p.connectionEpoch !== r.epoch) return reply(fail('STALE_EPOCH'));
      // Coordinate a new epoch for BOTH clients instead of locally rebuilding incompatible peers.
      if (r.lastRebuildAt && Date.now() - r.lastRebuildAt < 8_000) {
        // Both users may press Reconnect; report the in-flight recovery without
        // generating another incompatible WebRTC epoch or a confusing failure.
        return reply(ok({ connectionEpoch: r.epoch, alreadyRecovering: true }));
      }
      r.lastRebuildAt = Date.now(); store.rotateEpoch(r); resetPeers(r); reply(ok({ connectionEpoch: r.epoch }));
    }));
    socket.on('webrtc:ice-restart-request', (payload, ack) => allow('webrtc:ice-restart-request', payload, ack, (r, p, reply) => {
      if (!p || p.connectionEpoch !== r.epoch) return reply(fail('STALE_EPOCH'));
      if (role !== 'viewer') return reply(fail('FORBIDDEN'));
      sendPeer(r, role, 'webrtc:ice-restart-request', { connectionEpoch: r.epoch }); reply(ok({}));
    }));
    socket.on('disconnect', () => {
      connections.delete(socket.id);
      // Old sockets must never clear the new owner's slot.
      if (room[key] !== socket.id) return;
      room[key] = null; room[instanceKey] = null;
      // A short signaling outage need not interrupt an otherwise healthy media connection.
      const updatePresence = () => {
        graceTimers.delete(graceKey);
        if (!room[key] && store.get(room.id)) publishPresence(room);
      };
      if (disconnectGraceMs > 0) {
        const timer = setTimeout(updatePresence, disconnectGraceMs);
        timer.unref?.(); graceTimers.set(graceKey, timer);
      } else updatePresence();
    });
  });
  return { endRoom, resetPeers, publishPresence, sendPeer };
}
function validSdp(value, kind) {
  return typeof value === 'string' && value.length > 20 && value.length <= MAX_SDP && value.startsWith('v=0') && value.includes('m=') && ['offer', 'answer'].includes(kind);
}
function validCandidate(value) {
  return value === null || (typeof value === 'object' && value !== null && Object.keys(value).length <= 8 &&
    typeof value.candidate === 'string' && value.candidate.length <= 2048 &&
    (value.sdpMid == null || (typeof value.sdpMid === 'string' && value.sdpMid.length <= 80)) &&
    (value.sdpMLineIndex == null || (Number.isInteger(value.sdpMLineIndex) && value.sdpMLineIndex >= 0)));
}
function validateEnvelope(room, p, type, instanceId) {
  return p && typeof p === 'object' && p.roomId === room.id && p.connectionEpoch === room.epoch &&
    validId(p.negotiationId) && p.senderInstanceId === instanceId && p.messageType === type;
}
