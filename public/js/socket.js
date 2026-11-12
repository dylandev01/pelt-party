import { emitWithAck } from './utils.js';

// Socket.IO defaults to HTTP long-polling first, then upgrades to WebSocket.
// WebSocket-first with no fallback can get stuck behind privacy tools and proxies.
export function createSocket(roomId, events = {}) {
  if (!window.io) throw new Error('Socket.IO client script was not loaded');
  const instanceId = crypto.randomUUID();
  const socket = window.io({
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 700,
    reconnectionDelayMax: 7000,
    randomizationFactor: 0.5,
    timeout: 12_000,
    transports: ['polling', 'websocket'],
    upgrade: true,
    withCredentials: true,
    auth: { roomId, instanceId }
  });

  for (const [event, callback] of Object.entries(events)) {
    if (!event.startsWith('on') && typeof callback === 'function') socket.on(event, callback);
  }
  socket.on('connect', () => events.onConnection?.(true));
  socket.on('disconnect', reason => events.onConnection?.(false, reason));
  socket.on('connect_error', err => events.onError?.(err));
  socket.io.on('reconnect_attempt', attempt => events.onRetry?.(attempt));
  socket.io.on('reconnect_failed', () => events.onError?.(new Error('SIGNALING_DISCONNECTED')));
  socket.connect();

  const activity = setInterval(() => {
    if (socket.connected) emitWithAck(socket, 'room:activity', {}).catch(() => {});
  }, 25_000);

  return {
    socket,
    instanceId,
    send: (event, payload, timeout) => emitWithAck(socket, event, payload, timeout),
    close() {
      clearInterval(activity);
      socket.removeAllListeners();
      socket.disconnect();
    }
  };
}