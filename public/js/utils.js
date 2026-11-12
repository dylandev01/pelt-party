export const humanError = error => {
  const code = typeof error === 'string' ? error : error?.code || error?.message;
  return ({
    ROOM_FULL: 'This room already has a viewer. Ask the host for a new invitation.',
    ROOM_NOT_FOUND: 'This room is unavailable or has expired.',
    INVALID_PASSWORD: 'That password is not correct. Please try again.',
    WEAK_PASSWORD: 'Use a password containing at least eight characters.',
    TOO_MANY_ATTEMPTS: 'Too many attempts. Please try again later.',
    UNAUTHORIZED: 'Your room session has expired. Join again with the room password.',
    FORBIDDEN: 'Your account does not have permission for that action.',
    PEER_OFFLINE: 'Your friend is temporarily disconnected.',
    RATE_LIMITED: 'Too many connection messages. Give the connection a moment to recover.',
    NotAllowedError: 'Sharing was canceled or denied. Choose a source and try again.',
    NotFoundError: 'No available screen or window was found.',
    NotReadableError: 'The selected display could not be captured. Check system screen recording permissions.',
    InvalidStateError: 'Choose a screen directly after clicking Start Sharing.',
    TypeError: 'Advanced capture preferences were not accepted. Click Share again for a simpler request.',
    NotSupportedError: 'Screen sharing is not supported here. Try desktop Chrome or Edge.',
    AbortError: 'Screen sharing did not start. Please try again.',
    ICE_FAILED: 'The media connection failed. Trying to recover the connection…',
    SIGNALING_DISCONNECTED: 'The signaling server is temporarily disconnected.',
    BITRATE_UNSUPPORTED: 'The browser did not confirm this bitrate ceiling.',
    PLAYBACK_BLOCKED: 'Your browser requires a tap to enable playback sound.',
    SESSION_EXPIRED: 'This room session has expired.'
  })[code] || (error?.message?.startsWith('Network') ? 'Cannot reach the server. Check your connection.' : 'Something went wrong. Please try again.');
};
export const mbps = bits => `${(bits / 1e6).toFixed(1)} Mbps`;
export const formatRate = bits => Number.isFinite(bits) ? `${(bits / 1e6).toFixed(2)} Mbps` : 'N/A';
export const formatSize = (w, h) => w && h ? `${w} × ${h}` : 'N/A';
export function debounce(fn, ms) {
  let timeout;
  const handler = (...args) => { clearTimeout(timeout); timeout = setTimeout(() => fn(...args), ms); };
  handler.cancel = () => clearTimeout(timeout);
  return handler;
}
export function emitWithAck(socket, event, data, timeout = 10_000) {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) return reject(new Error('SIGNALING_DISCONNECTED'));
    socket.timeout(timeout).emit(event, data, (err, response) => {
      if (err) return reject(err);
      if (!response?.ok) return reject(Object.assign(new Error(response?.error || 'SIGNALING_ERROR'), { code: response?.error }));
      resolve(response);
    });
  });
}
