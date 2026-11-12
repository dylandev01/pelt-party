import { api } from './api.js';
import { createSocket } from './socket.js';
import { PeerController } from './peer.js';
import { CaptureManager } from './capture.js';
import { StatsSampler } from './stats.js';
import { humanError, debounce } from './utils.js';
import { $, show, text, toast, page, overlay, setHostState, renderStats, updateQualityLabel } from './ui.js';

const route = /^\/(host|r)\/([\w-]+)$/.exec(location.pathname);
let session = null, peer = null, stats = null, capture = null;
let roomId = route?.[2] || null, mode = route?.[1] === 'r' ? 'viewer' : route?.[1] || 'landing';
let viewerHasAudio = false, hostStream = { active: false, audio: false }, hostPeerState = 'idle';
let previewVisible = false, roomEnded = false, guestHere = false;

function teardown() {
  stats?.stop(); stats = null;
  peer?.close(); peer = null;
  session?.close(); session = null;
  capture?.stop(); capture = null;
}
function fail(error) { console.error(error); toast(humanError(error)); }
function showStats() {
  const open = $('statsPanel').hidden;
  show('statsPanel', open);
  if (open && peer) {
    stats ||= new StatsSampler(peer, renderStats);
    stats.start();
  } else stats?.stop();
}
$('hostStatsToggle').addEventListener('click', showStats);
$('viewerStatsToggle').addEventListener('click', showStats);
$('closeStats').addEventListener('click', () => { show('statsPanel', false); stats?.stop(); });

async function initialize() {
  if (mode === 'landing') { page('landing'); return; }
  if (mode === 'host') return setupHost();
  return setupViewer();
}
$('createRoom').addEventListener('click', async () => {
  const button = $('createRoom'); button.disabled = true; text('createRoom', 'CREATING YOUR THEATER…');
  try {
    const password = $('createPassword').value.trim() || undefined;
    const created = await api.create(password);
    roomId = created.roomId; mode = 'host';
    history.pushState({}, '', `/host/${roomId}`);
    await setupHost(created);
  } catch (error) { fail(error); }
  finally { button.disabled = false; text('createRoom', 'CREATE YOUR PRIVATE THEATER ↗'); }
});

async function setupHost(created = null) {
  page('host');
  roomEnded = false;
  $('inviteLink').value = `${location.origin}/r/${roomId}`;
  $('roomPassword').value = created?.password || '';
  $('copyPassword').disabled = !created?.password;
  let status;
  try { status = await api.status(roomId); if (status.role !== 'host') throw Error('UNAUTHORIZED'); }
  catch (error) { show('hostWarning'); text('hostWarning', humanError(error)); return; }
  hostStream = { active: false, audio: false };
  setHostState('idle');
  capture = new CaptureManager({ advanced: status.settings.advancedCapture,
    onEnded: () => { stopSharing().catch(fail); toast('Sharing stopped from the browser. Your room is still open.'); } });
  const handlers = {
    'room:ready': data => {
      text('hostSignal', 'Room connected'); onPresence(data);
      // Reconcile state in BOTH directions. A capture started while signaling
      // was down must be announced when the socket reconnects, without a fresh
      // getDisplayMedia() prompt or stopping the already-live capture.
      const active = Boolean(capture?.stream?.getVideoTracks().some(track => track.readyState === 'live'));
      const desired = { active, audio: active && capture.audioAvailable };
      if (data.stream?.active !== desired.active || data.stream?.audio !== desired.audio) {
        session?.send('stream:state', desired).catch(error => {
          console.warn('Stream status reconciliation failed:', error.message);
          text('hostWarning', 'Sharing is captured, but room signaling is still reconnecting.');
          show('hostWarning');
        });
      }
      if (active) refreshHostMediaState();
    },
    'room:presence': onPresence,
    'stream:state': data => { hostStream = data; refreshHostMediaState(); },
    'peer:reset': data => { peer?.reset(data.connectionEpoch); refreshHostMediaState(); },
    'peer:ready': data => peer?.start(data.connectionEpoch),
    'webrtc:answer': data => peer?.receiveAnswer(data),
    'webrtc:ice-candidate': data => peer?.receiveCandidate(data),
    'webrtc:ice-restart-request': data => peer?.restartRequested(data),
    'room:ended': endNotice,
    onConnection: (connected, reason) => {
      text('hostSignal', connected ? 'Room connected' : reason === 'io server disconnect' ? 'Room connection ended — reload page' : 'Signaling reconnecting…');
      if (connected) { show('hostWarning', false); refreshHostMediaState(); }
    },
    onRetry: () => text('hostSignal', 'Reconnecting to room…'),
    onError: error => {
      const message = humanError(error);
      text('hostSignal', message);
      if (['ROOM_NOT_FOUND', 'UNAUTHORIZED'].includes(error?.message)) {
        text('hostWarning', `${message} Return home and create a new room.`); show('hostWarning');
      }
      console.warn('Signaling connection issue:', error?.message);
    }
  };
  session = createSocket(roomId, handlers);
  peer = new PeerController({ roomId, role: 'host', socket: session.socket, instanceId: session.instanceId,
    settings: status.settings, onState: state => { hostPeerState = state; refreshHostMediaState(); },
    onError: error => { console.warn('WebRTC host:', error); text('hostConnection', humanError(error)); } });
  $('bitrateSlider').value = status.settings.defaultBitrate;
  $('bitrateSlider').min = status.settings.minBitrate;
  $('bitrateSlider').max = status.settings.maxBitrate;
  updateQualityLabel(status.settings.defaultBitrate);
}
function onPresence(data) {
  if (mode !== 'host') return;
  const connected = Boolean(data.viewerConnected); guestHere = connected;
  text('viewerPresence', connected ? 'Your guest is here' : 'Waiting for your guest');
  text('viewerPresenceDetail', connected ? 'One viewer connected securely.' : 'Their seat is ready whenever they are.');
  text('hostConnection', connected ? (peer?.pc?.connectionState === 'connected' ? 'Viewer connected' : 'Connecting to viewer…') : 'Waiting for viewer');
  if (!connected && capture?.stream) setHostState('sharing');
}
function refreshHostMediaState() {
  if (mode !== 'host') return;
  const active = Boolean(capture?.stream?.getVideoTracks().some(t => t.readyState === 'live'));
  const live = active && peer?.pc?.connectionState === 'connected';
  setHostState(live ? 'live' : active ? (hostPeerState === 'recovering' ? 'recovering' : 'sharing') : 'idle', capture?.audioAvailable);
  text('hostConnection', !guestHere ? 'Waiting for viewer' : live ? 'Viewer connected' : 'Connecting to viewer…');
  if (active) {
    const settings = capture.videoSettings;
    text('hostResolution', settings.width && settings.height ? `${settings.width} × ${settings.height} CAPTURE` : 'CAPTURING');
  } else text('hostResolution', '—');
}
async function startSharing() {
  if (!capture) return;
  show('hostWarning', false);
  // Important: FIRST async action is getDisplayMedia, directly within the click's activation context.
  const selection = capture.choose();
  let candidate;
  try {
    candidate = await selection;
    await peer.setCapture(candidate);
    capture.accept(candidate);
    $('hostPreview').srcObject = candidate;
    show('hostPlaceholder', false);
    show('hostPreview', previewVisible);
    show('previewHidden', !previewVisible);
    text('togglePreview', previewVisible ? 'Hide preview' : 'Show preview');
    hostStream = { active: true, audio: capture.audioAvailable };
    // The local capture has succeeded even if the signaling socket went away.
    // Do not dispose of the capture for a temporary network failure.
    try {
      await session.send('stream:state', hostStream);
    } catch (error) {
      text('hostWarning', 'Screen capture started, but the room is disconnected. Reconnecting signaling automatically; keep this tab open.');
      show('hostWarning');
      refreshHostMediaState();
      return;
    }
    if (!capture.audioAvailable) {
      text('hostWarning', 'Video is sharing, but no playback audio was captured. Try sharing a browser tab and enable “Share tab audio”, then choose Change source.');
      show('hostWarning');
    }
    refreshHostMediaState();
  } catch (error) {
    if (candidate && candidate !== capture.stream) candidate.getTracks().forEach(t => t.stop());
    text('hostWarning', humanError(error)); show('hostWarning');
    refreshHostMediaState();
  }
}
async function stopSharing() {
  if (!capture) return;
  await peer?.stopCapture();
  capture.stop(); hostStream = { active: false, audio: false };
  $('hostPreview').srcObject = null;
  show('hostPreview', false); show('previewHidden', false); show('hostPlaceholder', true);
  show('hostWarning', false);
  try { await session?.send('stream:state', hostStream); } catch { /* offline host still stops local capture */ }
  refreshHostMediaState();
}
$('startSharing').addEventListener('click', startSharing);
$('restartSharing').addEventListener('click', startSharing);
$('stopSharing').addEventListener('click', () => stopSharing().catch(fail));
$('togglePreview').addEventListener('click', () => {
  previewVisible = !previewVisible;
  show('hostPreview', previewVisible);
  show('previewHidden', !previewVisible && Boolean(capture?.stream));
  text('togglePreview', previewVisible ? 'Hide preview' : 'Show preview');
  if (previewVisible) $('hostPreview').play().catch(() => {});
});
$('copyLink').addEventListener('click', () => copyValue('inviteLink', 'Invitation link copied'));
$('copyPassword').addEventListener('click', () => copyValue('roomPassword', 'Room password copied'));
async function copyValue(id, message) {
  if (!$(id).value) return toast('This value is not available after a refresh.');
  try { await navigator.clipboard.writeText($(id).value); toast(message); }
  catch { $(id).focus(); $(id).select(); toast('Select and copy the highlighted value.'); }
}
const setBitrateLater = debounce(async bits => {
  if (!peer) return;
  try { await peer.updateBitrate(bits); }
  catch (e) { toast('Your browser could not apply this bitrate. The stream remains active.'); console.warn(e); }
}, 160);
$('bitrateSlider').addEventListener('input', event => {
  const bits = Number(event.target.value);
  updateQualityLabel(bits);
  $('qualityPreset').value = [...$('qualityPreset').options].some(o => Number(o.value) === bits) ? String(bits) : '10000000';
  setBitrateLater(bits);
});
$('qualityPreset').addEventListener('change', event => {
  const value = Number(event.target.value);
  $('bitrateSlider').value = value; updateQualityLabel(value); setBitrateLater(value);
});
$('endRoom').addEventListener('click', async () => {
  if (!confirm('End this room for you and your guest? This cannot be undone.')) return;
  try { await api.end(roomId); endNotice(); } catch (e) { fail(e); }
});
function endNotice() {
  if (roomEnded) return; roomEnded = true;
  teardown();
  toast('The room has ended.');
  setTimeout(() => { location.href = '/'; }, 1000);
}

async function setupViewer() {
  page('viewer'); show('viewerAuth', true); show('viewerExperience', false);
  try {
    const status = await api.status(roomId);
    if (status.role === 'viewer') return enterViewer(status);
  } catch (error) {
    if (error.code === 'ROOM_NOT_FOUND') {
      text('joinError', humanError(error)); show('joinError');
    }
  }
}
$('joinForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('joinRoom'); button.disabled = true;
  text('joinError', ''); show('joinError', false);
  try {
    await api.join(roomId, $('viewerPassword').value);
    const status = await api.status(roomId);
    await enterViewer(status);
  } catch (error) { text('joinError', humanError(error)); show('joinError'); }
  finally { button.disabled = false; }
});
async function enterViewer(status) {
  mode = 'viewer'; roomEnded = false;
  show('viewerAuth', false); show('viewerExperience', true);
  overlay('Waiting for the curtain to rise', 'Your host has not started sharing yet.');
  const video = $('remoteVideo'); video.volume = 1;
  viewerHasAudio = Boolean(status.stream?.audio);
  function onRemoteStream(stream) {
    if (video.srcObject !== stream) video.srcObject = stream;
    if (!stream.getVideoTracks().length) {
      if (hostStream.active) overlay('Connecting your stream', 'The theater is getting your picture ready.');
      return;
    }
    video.play().then(() => {
      const soundLocked = video.muted && viewerHasAudio;
      if (soundLocked) overlay('Ready for sound?', 'Click below to turn on movie audio.', { sound: true });
      else overlay('', '', { hidden: true });
      text('viewerPlaybackStatus', viewerHasAudio && video.muted ? 'VIDEO PLAYING · SOUND MUTED' : 'WATCHING LIVE');
    }).catch(() => overlay('Your screen is ready', 'Your browser requires a click before playing audio.', { sound: true }));
  }
  function onPresenceViewer(data) {
    if (data.stream) updateViewerStream(data.stream);
    if (!data.hostConnected && (!video.srcObject?.getVideoTracks().length || video.paused)) {
      overlay('Waiting for your host', 'The host is offline or reconnecting. Your seat is saved.');
      text('viewerPlaybackStatus', 'HOST OFFLINE');
    }
  }
  function updateViewerStream(streamState) {
    hostStream = streamState; viewerHasAudio = streamState.audio;
    show('viewerAudioWarning', streamState.active && !streamState.audio);
    if (streamState.active && !streamState.audio)
      text('viewerAudioWarning', 'The host is sharing video, but no playback audio track was captured. Ask them to re-share their tab with audio enabled.');
    if (!streamState.active) {
      overlay('The screen is quiet for now', 'Your host can resume sharing whenever they are ready.');
      text('viewerPlaybackStatus', 'WAITING FOR VIDEO');
    } else if (peer?.pc?.connectionState !== 'connected') {
      overlay('Connecting your stream', 'Establishing a private video connection…');
    }
  }
  const handlers = {
    'room:ready': data => { text('viewerSignal', 'Connected to theater'); onPresenceViewer(data); },
    'room:presence': onPresenceViewer,
    'stream:state': updateViewerStream,
    'peer:reset': data => { peer?.reset(data.connectionEpoch); overlay('Reconnecting picture', 'Restoring your private stream…'); },
    'peer:ready': data => peer?.start(data.connectionEpoch),
    'webrtc:offer': data => peer?.receiveOffer(data),
    'webrtc:ice-candidate': data => peer?.receiveCandidate(data),
    'room:ended': endNotice,
    onConnection: (connected, reason) => text('viewerSignal', connected ? 'Connected to theater' : reason === 'io server disconnect' ? 'Connection ended — reload page' : 'Signaling reconnecting…'),
    onRetry: () => text('viewerSignal', 'Reconnecting to theater…'),
    onError: error => { text('viewerSignal', humanError(error)); console.warn('Viewer signaling issue:', error?.message); }
  };
  session = createSocket(roomId, handlers);
  peer = new PeerController({ roomId, role: 'viewer', socket: session.socket, instanceId: session.instanceId,
    settings: status.settings, onRemoteStream, onState: state => {
      if (state === 'recovering' || state === 'failed') overlay('Reconnecting picture', 'Trying to restore your stream…', { retry: true });
      if (state === 'connected' && hostStream.active) onRemoteStream(peer.remoteStream);
    }, onError: error => { console.warn('WebRTC viewer:', error); overlay('Connection needs attention', humanError(error), { retry: true }); } });
}
$('playWithSound').addEventListener('click', async () => {
  const video = $('remoteVideo');
  video.muted = false; video.volume = Number($('viewerVolume').value) || 1;
  try { await video.play(); overlay('', '', { hidden: true }); text('viewerPlaybackStatus', 'WATCHING LIVE'); }
  catch { overlay('Tap to start watching', 'The browser has not allowed audio playback yet.', { sound: true }); }
});
$('viewerMute').addEventListener('click', () => {
  const video = $('remoteVideo'); video.muted = !video.muted;
  text('viewerMute', video.muted ? '♪̸' : '♪');
  if (!video.muted && video.paused) video.play().catch(() => overlay('Start watching with sound', 'Tap below to enable playback.', { sound: true }));
});
$('viewerVolume').addEventListener('input', event => {
  const video = $('remoteVideo'); video.volume = Number(event.target.value);
  if (video.volume === 0) video.muted = true;
  else if (video.muted) { video.muted = false; video.play().catch(() => overlay('Enable movie sound', 'Tap below to enable playback.', { sound: true })); }
  text('viewerMute', video.muted ? '♪̸' : '♪');
});
$('viewerFullscreen').addEventListener('click', async () => {
  try {
    const element = $('viewerTheater');
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (element.requestFullscreen) await element.requestFullscreen();
    else if ($('remoteVideo').webkitEnterFullscreen) $('remoteVideo').webkitEnterFullscreen();
    else throw new Error('Fullscreen is not supported in this browser');
  } catch (e) { toast(e.message); }
});
$('retryConnection').addEventListener('click', () => {
  if (!peer || !session) return;
  session.socket.disconnect(); session.socket.connect();
  overlay('Reconnecting', 'Requesting a fresh connection from the host…');
});
$('leaveRoom').addEventListener('click', async () => {
  try { await api.leave(roomId); } catch (e) { fail(e); }
  teardown(); location.href = '/';
});
window.addEventListener('pagehide', () => { stats?.stop(); capture?.stop(); });
window.addEventListener('popstate', () => location.reload());
initialize().catch(fail);