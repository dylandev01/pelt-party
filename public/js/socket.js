import { emitWithAck } from './utils.js';
export function createSocket(roomId, events = {}) {
  if (!window.io) throw new Error('Socket.IO client script was not loaded');
  const instanceId = crypto.randomUUID();
  const socket = window.io({ autoConnect: false, reconnection: true, reconnectionAttempts: Infinity,
    reconnectionDelay: 700, reconnectionDelayMax: 7000, randomizationFactor: 0.5,
    auth: { roomId, instanceId }, transports: ['websocket', 'polling'] });
  for (const [event, callback] of Object.entries(events)) socket.on(event, callback);
  socket.on('connect', () => events.onConnection?.(true));
  socket.on('disconnect', () => events.onConnection?.(false));
  socket.on('connect_error', err => events.onError?.(err));
  socket.connect();
  const activity = setInterval(() => {
    if (socket.connected) emitWithAck(socket, 'room:activity', {}).catch(() => {});
  }, 25_000);
  return { socket, instanceId, send: (event, payload, timeout) => emitWithAck(socket, event, payload, timeout),
    close() { clearInterval(activity); socket.removeAllListeners(); socket.disconnect(); } };
}
