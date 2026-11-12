import { createHmac } from 'node:crypto';
export function makeIceConfig(settings, subject, now = Date.now()) {
  const iceServers = [];
  if (settings.stunUrl) iceServers.push({ urls: settings.stunUrl });
  if (settings.turnUrls.length && settings.turnSecret) {
    const expires = Math.floor(now / 1000) + settings.turnTtlSeconds;
    // Coturn REST shared-secret scheme: username is expiry:opaqueSubject; password is HMAC-SHA1(username).
    const username = `${expires}:${subject}`;
    iceServers.push({ urls: settings.turnUrls, username,
      credential: createHmac('sha1', settings.turnSecret).update(username).digest('base64') });
  }
  return { iceServers, iceTransportPolicy: settings.forceRelay ? 'relay' : 'all',
    expiresAt: settings.turnUrls.length ? Math.floor(now / 1000) + settings.turnTtlSeconds : null };
}
