import { randomUUID } from 'node:crypto';
import { randomToken, tokenDigest, matchesToken, hashPassword, verifyPassword } from './auth.js';

export class RoomError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export class RoomStore {
  constructor({ idleMs = 3_600_000, maxMs = 43_200_000 } = {}) {
    this.rooms = new Map(); this.idleMs = idleMs; this.maxMs = maxMs;
  }
  async create(password) {
    if (password !== undefined && (typeof password !== 'string' || password.length < 8 || password.length > 128)) throw new RoomError('WEAK_PASSWORD');
    const pass = password ?? randomToken(12);
    const hostToken = randomToken();
    const id = randomToken(18);
    const now = Date.now();
    const room = { id, hostDigest: tokenDigest(hostToken), passwordHash: await hashPassword(pass), viewerDigest: null,
      createdAt: now, lastActiveAt: now, epoch: randomUUID(), negotiationId: null, negotiationAnswered: false,
      hostSocketId: null, viewerSocketId: null, hostInstance: null, viewerInstance: null,
      streamRevision: 0, stream: { active: false, audio: false }, passwordFailures: [], ended: false };
    this.rooms.set(id, room);
    return { room, hostToken, password: pass };
  }
  get(id) {
    const room = this.rooms.get(id);
    if (!room || this.expired(room)) return null;
    return room;
  }
  expired(room, now = Date.now()) {
    // Presence and periodic authenticated client activity keep an active session alive.
    return room.ended || now - room.createdAt >= this.maxMs || now - room.lastActiveAt >= this.idleMs;
  }
  touch(room) { room.lastActiveAt = Date.now(); }
  async join(room, password, existingToken) {
    if (!room || this.expired(room)) throw new RoomError('ROOM_NOT_FOUND', 404);
    if (room.viewerDigest && matchesToken(existingToken, room.viewerDigest)) {
      this.touch(room); return { token: existingToken, returning: true };
    }
    if (room.viewerDigest) throw new RoomError('ROOM_FULL', 409);
    room.passwordFailures = room.passwordFailures.filter(at => Date.now() - at < 600_000);
    if (room.passwordFailures.length >= 10) throw new RoomError('TOO_MANY_ATTEMPTS', 429);
    if (typeof password !== 'string' || password.length > 128 || !(await verifyPassword(password, room.passwordHash))) {
      room.passwordFailures.push(Date.now()); throw new RoomError('INVALID_PASSWORD', 401);
    }
    // No await between the free-slot check and assignment: concurrent joins cannot claim it twice.
    if (room.viewerDigest) throw new RoomError('ROOM_FULL', 409);
    const token = randomToken(); room.viewerDigest = tokenDigest(token);
    this.touch(room); return { token, returning: false };
  }
  rotateEpoch(room) {
    room.epoch = randomUUID(); room.negotiationId = null; room.negotiationAnswered = false;
    this.touch(room); return room.epoch;
  }
  leaveViewer(room) {
    room.viewerDigest = null; room.viewerSocketId = null; room.viewerInstance = null;
    this.rotateEpoch(room);
  }
  end(room) { room.ended = true; this.rooms.delete(room.id); }
  cleanup(onExpire) {
    for (const room of this.rooms.values()) if (this.expired(room)) { this.end(room); onExpire?.(room); }
  }
}
