import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { Server as SocketServer } from 'socket.io';
import { config } from './config.js';
import { RoomStore, RoomError } from './rooms.js';
import { cookieKey, cookieSettings, parseCookies, roleFromCookies } from './auth.js';
import { attachSignaling } from './signaling.js';
import { makeIceConfig } from './turn.js';

export function createApp(settings = config) {
  const app = express();
  const server = createServer(app);
  const rooms = new RoomStore({ idleMs: settings.roomIdleMs, maxMs: settings.roomMaxMs });
  const io = new SocketServer(server, {
    serveClient: true, maxHttpBufferSize: 128 * 1024,
    allowRequest: (req, callback) => callback(null, !req.headers.origin || req.headers.origin === settings.origin),
    cors: { origin: settings.origin, credentials: true }
  });
  const signaling = attachSignaling(io, rooms, { disconnectGraceMs: settings.disconnectGraceMs });
  const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
  const cookieMaxAge = settings.roomMaxMs;
  const allowedOrigin = req => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    const origin = req.headers.origin;
    // Browser-based unsafe requests contain Origin; command-line clients can omit it.
    return !origin || origin === settings.origin;
  };
  const error = (res, code, status = 400) => res.status(status).json({ ok: false, error: code });
  const roomFor = (req, res) => {
    const room = rooms.get(req.params.roomId);
    if (!room) { error(res, 'ROOM_NOT_FOUND', 404); return null; }
    return room;
  };
  const authorized = (req, res, room) => {
    const identity = roleFromCookies(room, req.headers.cookie);
    if (!identity) error(res, 'UNAUTHORIZED', 401);
    return identity;
  };
  app.disable('x-powered-by');
  app.set('trust proxy', settings.production ? 1 : false);
  app.use(helmet({ contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'],
    connectSrc: ["'self'", settings.origin.replace(/^http/, 'ws')], mediaSrc: ["'self'", 'blob:'],
    objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"]
  } } }));
  app.use(express.json({ limit: '8kb' }));
  app.use('/api', (req, res, next) => allowedOrigin(req) ? next() : error(res, 'INVALID_ORIGIN', 403));
  const creationLimit = rateLimit({ windowMs: 15 * 60_000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false });
  const joiningLimit = rateLimit({ windowMs: 10 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
  app.get('/health', (_req, res) => res.json({ ok: true, service: 'private-cinema' }));
  app.post('/api/rooms', creationLimit, async (req, res, next) => {
    try {
      const { room, hostToken, password } = await rooms.create(req.body?.password);
      res.cookie(cookieKey('host', room.id), hostToken, cookieSettings({ production: settings.production, maxAge: cookieMaxAge }));
      res.set('Cache-Control', 'no-store').status(201).json({ ok: true, roomId: room.id,
        inviteUrl: `${settings.origin}/r/${room.id}`, hostUrl: `${settings.origin}/host/${room.id}`, password });
    } catch (e) { next(e); }
  });
  app.post('/api/rooms/:roomId/join', joiningLimit, async (req, res, next) => {
    try {
      const room = roomFor(req, res); if (!room) return;
      const existingToken = parseCookies(req.headers.cookie)[cookieKey('viewer', room.id)];
      const { token, returning } = await rooms.join(room, req.body?.password, existingToken);
      res.cookie(cookieKey('viewer', room.id), token, cookieSettings({ production: settings.production, maxAge: cookieMaxAge }));
      res.set('Cache-Control', 'no-store').json({ ok: true, returning });
    } catch (e) { next(e); }
  });
  app.get('/api/rooms/:roomId/status', (req, res) => {
    const room = roomFor(req, res); if (!room) return;
    const identity = authorized(req, res, room); if (!identity) return;
    rooms.touch(room);
    res.set('Cache-Control', 'no-store').json({ ok: true, role: identity.role, roomId: room.id,
      stream: { ...room.stream }, streamRevision: room.streamRevision,
      hostConnected: Boolean(room.hostSocketId), viewerConnected: Boolean(room.viewerSocketId),
      settings: { defaultBitrate: settings.defaultBitrate, minBitrate: settings.minBitrate,
        maxBitrate: settings.maxBitrate, sdpHints: settings.sdpHints, opusHints: settings.opusHints,
        advancedCapture: settings.advancedCapture } });
  });
  app.get('/api/ice-config', (req, res) => {
    const roomId = req.query.roomId;
    const room = rooms.get(roomId);
    if (!room) return error(res, 'ROOM_NOT_FOUND', 404);
    const identity = authorized(req, res, room); if (!identity) return;
    res.set('Cache-Control', 'no-store').json({ ok: true, ...makeIceConfig(settings, `${room.id.slice(0, 12)}-${identity.role}`) });
  });
  app.post('/api/rooms/:roomId/leave', (req, res) => {
    const room = roomFor(req, res); if (!room) return;
    const identity = authorized(req, res, room); if (!identity) return;
    if (identity.role !== 'viewer') return error(res, 'FORBIDDEN', 403);
    const prior = room.viewerSocketId;
    rooms.leaveViewer(room);
    res.clearCookie(cookieKey('viewer', room.id), cookieSettings({ production: settings.production, maxAge: cookieMaxAge }, true));
    if (prior) { io.to(prior).emit('room:ended'); io.sockets.sockets.get(prior)?.disconnect(true); }
    signaling.resetPeers(room); signaling.publishPresence(room);
    res.json({ ok: true });
  });
  app.delete('/api/rooms/:roomId', (req, res) => {
    const room = roomFor(req, res); if (!room) return;
    const identity = authorized(req, res, room); if (!identity) return;
    if (identity.role !== 'host') return error(res, 'FORBIDDEN', 403);
    signaling.endRoom(room);
    res.clearCookie(cookieKey('host', room.id), cookieSettings({ production: settings.production, maxAge: cookieMaxAge }, true));
    res.json({ ok: true });
  });
  app.use('/api', (_req, res) => error(res, 'NOT_FOUND', 404));
  app.use(express.static(base, { fallthrough: true, index: 'index.html', setHeaders: (res, file) => {
    if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  } }));
  app.get(/^(\/host\/[^/]+|\/r\/[^/]+)$/, (_req, res) => res.sendFile(path.join(base, 'index.html')));
  app.use((err, _req, res, _next) => {
    if (err instanceof RoomError) return error(res, err.code, err.status);
    if (err.type === 'entity.too.large') return error(res, 'PAYLOAD_TOO_LARGE', 413);
    if (err instanceof SyntaxError && err.status === 400) return error(res, 'INVALID_JSON', 400);
    console.error('Server error:', err?.message || err);
    return error(res, 'SERVER_ERROR', 500);
  });
  const ticker = setInterval(() => rooms.cleanup(room => {
    for (const id of [room.hostSocketId, room.viewerSocketId]) if (id) {
      io.to(id).emit('room:ended'); io.sockets.sockets.get(id)?.disconnect(true);
    }
  }), 30_000);
  ticker.unref();
  const close = async () => {
    clearInterval(ticker);
    await new Promise(resolve => io.close(() => resolve()));
    if (server.listening) await new Promise(resolve => server.close(() => resolve()));
  };
  return { app, server, io, rooms, close };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const running = createApp();
  running.server.listen(config.port, () => console.log(`Private Cinema ready on ${config.origin}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => running.close().finally(() => process.exit(0)));
}
