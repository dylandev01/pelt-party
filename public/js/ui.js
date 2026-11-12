import { mbps } from './utils.js';
export const $ = id => document.getElementById(id);
export const show = (id, value = true) => { const el = $(id); if (el) el.hidden = !value; };
export const text = (id, value) => { const el = $(id); if (el) el.textContent = value; };
let toastTimer;
export function toast(message) { const element = $('toast'); element.textContent = message; element.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { element.hidden = true; }, 4200); }
export function page(name) { for (const id of ['landing', 'host', 'viewer']) show(id, id === name); }
export function setHostState(state, audio) {
  const live = state === 'live';
  text('hostStatusPill', live ? (audio ? '● STREAMING LIVE' : '● VIDEO LIVE · NO AUDIO') :
    state === 'sharing' ? '● READY TO CONNECT' : state === 'recovering' ? '● RECONNECTING' : '○ NOT SHARING');
  $('hostStatusPill').dataset.live = String(live);
  $('startSharing').disabled = state === 'sharing' || live;
  $('stopSharing').disabled = state === 'idle';
  $('restartSharing').disabled = state === 'idle';
  $('togglePreview').disabled = state === 'idle';
}
export function renderStats(data) {
  const entries = $('statsEntries');
  const items = data.unavailable ? [['Diagnostics', 'Unavailable']] : [
    ['Resolution', data.size], ['Video FPS', Number.isFinite(data.fps) ? data.fps.toFixed(1) : 'N/A'],
    ['Video bitrate', data.videoLabel], ['Audio bitrate', data.audioLabel],
    ['Packet loss', Number.isFinite(data.loss) ? `${data.loss.toFixed(2)}%` : 'N/A'],
    ['Network RTT', Number.isFinite(data.rtt) ? `${data.rtt.toFixed(0)} ms` : 'N/A'],
    ['Codec', data.codec], ['Connection path', data.transport], ['ICE status', data.ice],
    ['Max bitrate', data.ceiling ? mbps(data.ceiling) : 'Set by host']
  ];
  // Text-only rendering, without injecting arbitrary messages into HTML.
  entries.replaceChildren(...items.map(([key, value]) => {
    const div = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = key; dd.textContent = value || 'N/A'; div.append(dt, dd); return div;
  }));
}
export function overlay(title, description, { sound = false, retry = false, hidden = false } = {}) {
  text('viewerOverlayTitle', title); text('viewerOverlayText', description);
  show('viewerOverlay', !hidden); show('playWithSound', sound); show('retryConnection', retry);
}
export function updateQualityLabel(value) { text('bitrateValue', mbps(Number(value))); }
