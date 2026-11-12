export class ApiError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}
async function request(url, method = 'GET', payload) {
  const response = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store',
    headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload) });
  const body = await response.json().catch(() => ({ error: 'INVALID_SERVER_RESPONSE' }));
  if (!response.ok || body.ok === false) throw new ApiError(body.error || 'REQUEST_FAILED', response.status);
  return body;
}
export const api = {
  create: password => request('/api/rooms', 'POST', password ? { password } : {}),
  join: (id, password) => request(`/api/rooms/${encodeURIComponent(id)}/join`, 'POST', { password }),
  status: id => request(`/api/rooms/${encodeURIComponent(id)}/status`),
  ice: id => request(`/api/ice-config?roomId=${encodeURIComponent(id)}`),
  leave: id => request(`/api/rooms/${encodeURIComponent(id)}/leave`, 'POST', {}),
  end: id => request(`/api/rooms/${encodeURIComponent(id)}`, 'DELETE')
};
