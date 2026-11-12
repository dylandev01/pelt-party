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
test('soft reconnect waits for authenticated room:ready and does not tear down live connection', async () => {
  const priorWindow = globalThis.window;
  const listeners = new Map();
  let connectCalls = 0, disconnectCalls = 0;
  const socket = {
    connected: true,
    on(type, callback) { const list = listeners.get(type) || []; list.push(callback); listeners.set(type, list); return this; },
    off(type, callback) { listeners.set(type, (listeners.get(type) || []).filter(fn => fn !== callback)); return this; },
    io: { on() {} },
    connect() { connectCalls++; },
    disconnect() { disconnectCalls++; },
    removeAllListeners() { listeners.clear(); },
    emitEvent(type, data) { for (const listener of [...(listeners.get(type) || [])]) listener(data); }
  };
  globalThis.window = { io: () => socket };
  try {
    const session = createSocket('r');
    assert.deepEqual(await session.reconnect(), { reconnected: false });
    assert.equal(disconnectCalls, 0);
    socket.connected = false;
    const recovery = session.reconnect();
    assert.equal(connectCalls, 2);
    socket.connected = true;
    socket.emitEvent('room:ready', { connectionEpoch: 'new' });
    assert.deepEqual(await recovery, { reconnected: true });
    assert.equal(disconnectCalls, 0);
    session.close();
  } finally { globalThis.window = priorWindow; }
});
