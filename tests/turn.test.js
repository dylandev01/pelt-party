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
