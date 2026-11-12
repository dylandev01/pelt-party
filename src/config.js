import 'dotenv/config';
import { randomBytes } from 'node:crypto';

const bool = (name, fallback) => {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  if (!['true', 'false'].includes(value)) throw new Error(`${name} must be true or false`);
  return value === 'true';
};
const int = (name, fallback, min, max) => {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer`);
  const result = Number(value);
  if (result < min || result > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return result;
};
const production = process.env.NODE_ENV === 'production';
const secret = process.env.SESSION_SECRET;
if (production && (!secret || secret.length < 32 || /^REPLACE|^CHANGE|^DEV/i.test(secret))) {
  throw new Error('Production requires a strong, unique SESSION_SECRET (at least 32 characters)');
}
const origin = process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';
const stunOnlyTestMode = bool('ALLOW_STUN_ONLY_TEST_MODE', false);
const publicUrl = new URL(origin);
if (publicUrl.origin !== origin.replace(/\/$/, '') || (production && publicUrl.protocol !== 'https:')) {
  throw new Error('PUBLIC_ORIGIN must be an origin (HTTPS in production), without a path');
}
if (production && !stunOnlyTestMode && (!process.env.TURN_SHARED_SECRET || !(process.env.TURN_URL || process.env.TURN_TLS_URL))) {
  throw new Error('Production requires TURN_URL (or TURN_TLS_URL) and TURN_SHARED_SECRET, unless explicitly using ALLOW_STUN_ONLY_TEST_MODE=true for a limited demonstration');
}
if (production && stunOnlyTestMode && (!process.env.TURN_SHARED_SECRET || !(process.env.TURN_URL || process.env.TURN_TLS_URL))) {
  console.warn('WARNING: STUN-only test mode: many cross-network WebRTC connections will fail without a TURN server. Do not treat this as a production-ready configuration.');
}
export const config = Object.freeze({
  production,
  stunOnlyTestMode,
  port: int('PORT', 3000, 1, 65535),
  origin: publicUrl.origin,
  sessionSecret: secret && secret.length >= 32 && !secret.startsWith('REPLACE') ? secret : randomBytes(32).toString('hex'),
  roomIdleMs: int('ROOM_IDLE_TTL_MINUTES', 60, 1, 10080) * 60_000,
  roomMaxMs: int('ROOM_MAX_TTL_HOURS', 12, 1, 168) * 3_600_000,
  disconnectGraceMs: int('DISCONNECT_GRACE_SECONDS', 15, 0, 120) * 1000,
  stunUrl: process.env.STUN_URL || '',
  turnUrls: [process.env.TURN_URL, process.env.TURN_TLS_URL].filter(Boolean),
  turnSecret: process.env.TURN_SHARED_SECRET || '',
  turnTtlSeconds: int('TURN_TTL_SECONDS', 3600, 300, 86400),
  forceRelay: bool('TURN_FORCE_RELAY', false),
  defaultBitrate: int('DEFAULT_VIDEO_BITRATE_BPS', 10_000_000, 2_000_000, 12_000_000),
  minBitrate: int('MIN_VIDEO_BITRATE_BPS', 2_000_000, 100_000, 12_000_000),
  maxBitrate: int('MAX_VIDEO_BITRATE_BPS', 12_000_000, 2_000_000, 30_000_000),
  sdpHints: bool('ENABLE_SDP_BITRATE_HINTS', true),
  opusHints: bool('ENABLE_OPUS_STEREO_HINTS', true),
  advancedCapture: bool('ENABLE_ADVANCED_CAPTURE_HINTS', true),
  debug: bool('ENABLE_DEBUG_LOGGING', false)
});
if (config.minBitrate > config.defaultBitrate || config.defaultBitrate > config.maxBitrate) throw new Error('Bitrate limits are inconsistent');
if (config.forceRelay && !config.turnUrls.length) throw new Error('TURN_FORCE_RELAY requires TURN configuration');
