import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSocket } from '../public/js/socket.js';

test('Socket.IO starts with polling and upgrades to WebSocket, preserving credentials', () => {
  const previous = globalThis.window;
  let options; let connected = false; const listeners = {}; const managerListeners = {};
  const fakeSocket = {
    connected: false,
    on(name, handler) { listeners[name] = handler; return this; },
    io: { on(name, handler) { managerListeners[name] = handler; } },
    connect() { connected = true; }, disconnect() {}, removeAllListeners() {},
  };
  globalThis.window = { io(value) { options = value; return fakeSocket; } };
  try {
    let status;
    const session = createSocket('room-test', { onConnection: value => { status = value; } });
    assert.equal(connected, true);
    assert.deepEqual(options.transports, ['polling', 'websocket']);
    assert.equal(options.withCredentials, true);
    assert.equal(options.upgrade, true);
    assert.equal(options.auth.roomId, 'room-test');
    listeners.connect();
    assert.equal(status, true);
    listeners.disconnect('transport close');
    assert.equal(status, false);
    assert.equal(typeof managerListeners.reconnect_attempt, 'function');
    session.close();
  } finally { globalThis.window = previous; }
});