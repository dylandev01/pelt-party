import { createHmac } from 'node:crypto';

// ICE credentials are delivered only to authenticated room participants.
// Static-provider credentials are evaluation-only; unlike Coturn's REST secret,
// they cannot be renewed after the provider-issued expiration timestamp.
export function makeIceConfig(settings, subject, now = Date.now()) {
  const iceServers = [];
  if (settings.stunUrl) iceServers.push({ urls: settings.stunUrl });
  const seconds = Math.floor(now / 1000);
  const provided = settings.staticTurn;
  let expiresAt = null;
  let turnStatus = 'unconfigured';

  if (provided?.urls?.length && provided.username && provided.credential) {
    if (Number.isSafeInteger(provided.expiresAt) && provided.expiresAt > seconds + 15) {
      iceServers.push({
        urls: provided.urls,
        username: provided.username,
        credential: provided.credential
      });
      expiresAt = provided.expiresAt;
      turnStatus = 'temporary';
    } else {
      turnStatus = 'expired';
    }
  }

  if (!expiresAt && settings.turnUrls?.length && settings.turnSecret) {
    expiresAt = seconds + settings.turnTtlSeconds;
    const username = `${expiresAt}:${subject}`;
    iceServers.push({
      urls: settings.turnUrls,
      username,
      credential: createHmac('sha1', settings.turnSecret).update(username).digest('base64')
    });
    turnStatus = 'coturn';
  }
  return {
    iceServers,
    iceTransportPolicy: settings.forceRelay ? 'relay' : 'all',
    expiresAt,
    turnStatus
  };
}
