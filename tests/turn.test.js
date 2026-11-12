import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { makeIceConfig } from '../src/turn.js';

test('issues Coturn-compatible ephemeral credentials without exposing shared secret', () => {
  const secret = 'this-is-a-real-test-secret-only';
  const setting = { stunUrl: 'stun:example.test:3478', turnUrls: ['turn:example.test:3478?transport=udp'],
    turnSecret: secret, turnTtlSeconds: 3600, forceRelay: false };
  const config = makeIceConfig(setting, 'room-host', 2000 * 1000);
  assert.equal(config.iceServers.length, 2);
  const turn = config.iceServers[1];
  assert.equal(turn.username, '5600:room-host');
  assert.equal(turn.credential, createHmac('sha1', secret).update(turn.username).digest('base64'));
  assert.equal(JSON.stringify(config).includes(secret), false);
  assert.equal(config.iceTransportPolicy, 'all');
});
test('relay-only policy and missing STUN/TURN settings', () => {
  const config = makeIceConfig({ stunUrl: '', turnUrls: [], turnSecret: '', turnTtlSeconds: 3600, forceRelay: true }, 'viewer');
  assert.deepEqual(config.iceServers, []);
  assert.equal(config.iceTransportPolicy, 'relay');
});

test('accepts opaque third-party TURN credentials until their actual expiration time', () => {
  const settings = {
    stunUrl: 'stun:example.org:3478', turnUrls: [], turnSecret: '',
    staticTurn: {
      urls: ['turn:relay.example.org:3478?transport=udp', 'turns:relay.example.org:5349?transport=tcp'],
      username: 'opaque-provider-identity', credential: 'opaque-provider-password', expiresAt: 2000
    },
    forceRelay: false
  };
  const ready = makeIceConfig(settings, 'host', 1000 * 1000);
  assert.deepEqual(ready.iceServers[1], {
    urls: settings.staticTurn.urls,
    username: settings.staticTurn.username,
    credential: settings.staticTurn.credential
  });
  assert.equal(ready.turnStatus, 'temporary');
  assert.equal(ready.expiresAt, 2000);
  const stale = makeIceConfig(settings, 'host', 1985 * 1000);
  assert.equal(stale.turnStatus, 'expired');
  assert.equal(stale.expiresAt, null);
  assert.equal(stale.iceServers.length, 1); // STUN continues; no expired relay.
});
test('falls back to Coturn when temporary third-party credentials expire', () => {
  const settings = {
    stunUrl: '', turnUrls: ['turn:own.example.org:3478'], turnSecret: 'never-public',
    turnTtlSeconds: 600, forceRelay: false,
    staticTurn: { urls: ['turn:temp.example.org:3478'], username: 'old', credential: 'old', expiresAt: 1500 }
  };
  const config = makeIceConfig(settings, 'viewer', 2000 * 1000);
  assert.equal(config.turnStatus, 'coturn');
  assert.equal(config.iceServers[0].username, '2600:viewer');
  assert.equal(config.expiresAt, 2600);
});
