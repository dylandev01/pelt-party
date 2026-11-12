import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { PeerController } from '../public/js/peer.js';

// Browser-independent test double for state-machine behavior; not a real WebRTC integration test.
const SDP = [
  'v=0','o=- 1 1 IN IP4 127.0.0.1','s=-','t=0 0','a=group:BUNDLE 0 1',
  'm=audio 9 UDP/TLS/RTP/SAVPF 109', 'c=IN IP4 0.0.0.0','a=mid:0','a=rtpmap:109 opus/48000/2',
  'm=video 9 UDP/TLS/RTP/SAVPF 96', 'c=IN IP4 0.0.0.0','a=mid:1','a=rtpmap:96 VP8/90000'
].join('\r\n') + '\r\n';
class FakeStream {
  constructor(tracks = []) { this.tracks = [...tracks]; }
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); }
  getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
  addTrack(track) { this.tracks.push(track); }
  removeTrack(track) { this.tracks = this.tracks.filter(t => t !== track); }
}
class FakeSender {
  constructor() { this.track = null; this.parameters = { transactionId: 'test', encodings: [{}] }; }
  async replaceTrack(track) { this.track = track; }
  getParameters() { return JSON.parse(JSON.stringify(this.parameters)); }
  async setParameters(parameters) { this.parameters = structuredClone(parameters); }
}
class FakePC {
  constructor() { this.transceivers = []; this.signalingState = 'stable'; this.connectionState = 'new'; this.iceConnectionState = 'new'; this.closed = false; }
  addTransceiver(kind) { const tx = { kind, sender: new FakeSender(), setCodecPreferences() {} }; this.transceivers.push(tx); return tx; }
  async createOffer() { return { type: 'offer', sdp: SDP }; }
  async createAnswer() { return { type: 'answer', sdp: SDP }; }
  async setLocalDescription(description) { this.localDescription = description; this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable'; }
  async setRemoteDescription(description) { this.remoteDescription = description; this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable'; }
  async addIceCandidate(candidate) { (this.iceCandidates ||= []).push(candidate); }
  close() { this.closed = true; this.signalingState = 'closed'; }
}
const settings = { defaultBitrate: 10e6, sdpHints: true, opusHints: true };
const tick = () => new Promise(resolve => setTimeout(resolve, 25));

const restore = { fetch: globalThis.fetch, RTCPeerConnection: globalThis.RTCPeerConnection,
  RTCRtpSender: globalThis.RTCRtpSender, MediaStream: globalThis.MediaStream,
  crypto: globalThis.crypto, navigator: globalThis.navigator };

test('host negotiates only with current viewer epoch, preserves capture on peer reset and replaces tracks', async () => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, writable: true, configurable: true });
  globalThis.MediaStream = FakeStream;
  globalThis.RTCPeerConnection = FakePC;
  globalThis.RTCRtpSender = { getCapabilities: () => ({ codecs: [{ mimeType: 'video/VP8' }] }) };
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'TestBrowser' }, writable: true, configurable: true });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, iceServers: [], iceTransportPolicy: 'all' }) });
  let host, viewer;
  const hostSocket = { connected: true, timeout: () => ({ emit(event, message, cb) {
    cb(null, { ok: true });
    if (event === 'webrtc:offer') queueMicrotask(() => viewer.receiveOffer(message));
  } }) };
  const viewerSocket = { connected: true, timeout: () => ({ emit(event, message, cb) {
    cb(null, { ok: true });
    if (event === 'webrtc:answer') queueMicrotask(() => host.receiveAnswer(message));
  } }) };
  try {
    const roomId = 'testRoom'; const epoch1 = 'epoch1';
    viewer = new PeerController({ roomId, role: 'viewer', socket: viewerSocket, instanceId: 'viewer1', settings });
    host = new PeerController({ roomId, role: 'host', socket: hostSocket, instanceId: 'host1', settings });
    viewer.reset(epoch1); host.reset(epoch1);
    await viewer.start(epoch1); await host.start(epoch1);
    await tick(); assert.equal(host.pending, false);
    const originalPC = host.pc;
    const firstCapture = new FakeStream([{ kind: 'video', id: 'v1', readyState: 'live' }, { kind: 'audio', id: 'a1', readyState: 'live' }]);
    await host.setCapture(firstCapture);
    assert.equal(host.videoTx.sender.track.id, 'v1');
    await host.updateBitrate(4e6);
    assert.equal(host.videoTx.sender.getParameters().encodings[0].maxBitrate, 4e6);
    const nextCapture = new FakeStream([{ kind: 'video', id: 'v2', readyState: 'live' }]);
    await host.setCapture(nextCapture);
    assert.equal(host.videoTx.sender.track.id, 'v2');
    assert.equal(host.audioTx.sender.track, null);
    const epoch2 = 'epoch2';
    host.reset(epoch2); viewer.reset(epoch2);
    assert.equal(originalPC.closed, true);
    assert.equal(host.capture, nextCapture);
    await viewer.start(epoch2); await host.start(epoch2);
    await tick(); assert.equal(host.videoTx.sender.track.id, 'v2');
    assert.equal(host.videoTx.sender.getParameters().encodings[0].maxBitrate, 4e6);
    const oldMessage = { roomId, connectionEpoch: epoch1, messageType: 'answer', negotiationId: 'old', payload: { sdp: SDP } };
    await host.receiveAnswer(oldMessage);
    assert.equal(host.epoch, epoch2);
    assert.equal(host.pc.transceivers.length, 2);
    assert.equal(viewer.pc.transceivers.length, 0);
  } finally {
    host?.close(); viewer?.close();
    for (const [name, original] of Object.entries(restore)) {
      if (original === undefined) delete globalThis[name];
      else Object.defineProperty(globalThis, name, { value: original, configurable: true, writable: true });
    }
  }
});
