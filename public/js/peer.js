import { api } from './api.js';
import { emitWithAck } from './utils.js';
import { safeSdpTransform, configureOpusStereo, setVideoBandwidthHints } from './sdp.js';

// One owner of RTCPeerConnection. No microphone, webcam, or local receiving tracks are ever requested.
export class PeerController {
  constructor({ roomId, role, socket, instanceId, settings, onState = () => {}, onRemoteStream = () => {}, onError = () => {} }) {
    Object.assign(this, { roomId, role, socket, instanceId, settings, onState, onRemoteStream, onError });
    this.pc = null; this.capture = null; this.epoch = null; this.ready = false; this.generation = 0;
    this.negotiationId = null; this.pending = false; this.scheduled = false; this.iceRestart = false;
    this.remoteReady = false; this.candidatesReady = false; this.inboundCandidates = new Map();
    this.outboundCandidates = []; this.seenCandidates = new Set(); this.answerQueue = Promise.resolve();
    this.remoteStream = new MediaStream(); this.targetBitrate = settings.defaultBitrate;
    this.parameterQueue = Promise.resolve(); this.candidateChain = Promise.resolve(); this.peerCreation = null; this.recoveryTimer = null; this.failures = 0;
    this.lastRebuild = 0; this.closed = false;
  }
  envelope(type, payload, negotiationId = this.negotiationId) {
    return { roomId: this.roomId, connectionEpoch: this.epoch, negotiationId,
      senderInstanceId: this.instanceId, messageType: type, payload };
  }
  isCurrent(generation) { return !this.closed && this.generation === generation; }
  reset(epoch) {
    if (!epoch || (epoch === this.epoch && !this.ready && !this.pc)) return;
    this.generation++; this.epoch = epoch; this.ready = false; this.failures = 0;
    this.destroyPeer();
    this.onState('reset');
  }
  async start(epoch) {
    if (epoch !== this.epoch) this.reset(epoch);
    if (this.ready && this.pc) return;
    this.ready = true;
    const generation = this.generation;
    try {
      await this.ensurePeer(generation);
      if (this.role === 'host' && this.isCurrent(generation)) await this.negotiate();
    } catch (e) { if (this.isCurrent(generation)) this.onError(e); }
  }
  async ensurePeer(generation = this.generation) {
    if (this.pc) return this.pc;
    // Two asynchronous callers (peer:ready and an early remote offer) must never build two PCs.
    if (this.peerCreation) return this.peerCreation;
    const operation = this.createPeer(generation);
    this.peerCreation = operation;
    try { return await operation; }
    finally { if (this.peerCreation === operation) this.peerCreation = null; }
  }
  async createPeer(generation) {
    const config = await api.ice(this.roomId);
    if (!this.isCurrent(generation)) return null;
    const pc = new RTCPeerConnection({ iceServers: config.iceServers, iceTransportPolicy: config.iceTransportPolicy });
    this.pc = pc;
    if (this.role === 'host') {
      this.videoTx = pc.addTransceiver('video', { direction: 'sendonly' });
      this.audioTx = pc.addTransceiver('audio', { direction: 'sendonly' });
      this.preferVideoCodecs();
      if (this.capture) await this.attachCapture(this.capture, generation);
    }
    pc.onicecandidate = event => {
      if (!this.isCurrent(generation)) return;
      const candidate = event.candidate?.toJSON() ?? null;
      // ICE restarts can surface a late candidate from an older ICE generation.
      const ufrag = candidate?.usernameFragment;
      if (ufrag && pc.localDescription?.sdp && !pc.localDescription.sdp.includes(`a=ice-ufrag:${ufrag}`)) return;
      if (!this.candidatesReady || !this.negotiationId) {
        if (this.outboundCandidates.length < 200) this.outboundCandidates.push(candidate);
      } else this.sendCandidate(candidate);
    };
    pc.ontrack = event => {
      if (!this.isCurrent(generation)) return;
      const track = event.track;
      if (!this.remoteStream.getTracks().some(t => t.id === track.id)) this.remoteStream.addTrack(track);
      track.addEventListener('ended', () => {
        if (this.remoteStream.getTracks().includes(track)) this.remoteStream.removeTrack(track);
        this.onRemoteStream(this.remoteStream);
      }, { once: true });
      this.onRemoteStream(this.remoteStream);
    };
    pc.onconnectionstatechange = () => {
      if (!this.isCurrent(generation)) return;
      this.onState(pc.connectionState);
      if (pc.connectionState === 'connected') { clearTimeout(this.recoveryTimer); this.failures = 0; }
      if (pc.connectionState === 'disconnected') this.scheduleRecovery(generation, 8000);
      if (pc.connectionState === 'failed') this.scheduleRecovery(generation, 100);
    };
    pc.onnegotiationneeded = () => {
      if (this.role === 'host' && this.ready && !this.pending && pc.signalingState === 'stable') this.scheduleNegotiation();
    };
    this.onState('connecting');
    return pc;
  }
  preferVideoCodecs() {
    if (!this.videoTx?.setCodecPreferences || !RTCRtpSender.getCapabilities) return;
    try {
      const codecs = RTCRtpSender.getCapabilities('video')?.codecs || [];
      const preferences = ['video/H264', 'video/VP9', 'video/VP8', 'video/AV1'];
      const reordered = [...codecs].sort((a, b) => {
        const rank = c => { const idx = preferences.findIndex(p => c.mimeType.toLowerCase() === p.toLowerCase()); return idx < 0 ? 100 : idx; };
        return rank(a) - rank(b);
      });
      this.videoTx.setCodecPreferences(reordered);
    } catch { /* codec API is optional; regular SDP negotiation remains enabled */ }
  }
  async attachCapture(stream, generation = this.generation) {
    const video = stream?.getVideoTracks()[0] || null;
    const audio = stream?.getAudioTracks()[0] || null;
    if (!this.videoTx || !this.audioTx) return;
    await this.videoTx.sender.replaceTrack(video);
    if (!this.isCurrent(generation)) return;
    await this.audioTx.sender.replaceTrack(audio);
    if (!this.isCurrent(generation)) return;
    // An unsupported tuning parameter must never prevent an otherwise valid capture.
    await this.syncBitrate().catch(error => console.warn('Bitrate tuning unavailable:', error.name));
  }
  async setCapture(stream) {
    if (this.role !== 'host') return;
    const old = this.capture;
    this.capture = stream;
    try {
      if (this.pc) await this.attachCapture(stream);
      if (this.pc && this.ready) this.scheduleNegotiation();
    } catch (error) {
      this.capture = old;
      if (this.pc) await this.attachCapture(old).catch(() => {});
      throw error;
    }
  }
  async stopCapture() { await this.setCapture(null); }
  scheduleNegotiation() {
    if (!this.ready || !this.pc || this.role !== 'host' || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(async () => {
      this.scheduled = false;
      if (!this.ready || !this.pc) return;
      if (this.pending || this.pc.signalingState !== 'stable') { this.wantsNegotiation = true; return; }
      try { await this.negotiate(); } catch (e) { this.onError(e); }
    });
  }
  async negotiate() {
    const generation = this.generation;
    const pc = this.pc;
    if (!pc || !this.ready || this.role !== 'host') return;
    if (this.pending || pc.signalingState !== 'stable') { this.wantsNegotiation = true; return; }
    this.pending = true; this.candidatesReady = false; this.outboundCandidates = [];
    const negotiationId = crypto.randomUUID(); this.negotiationId = negotiationId;
    this.remoteReady = false;
    try {
      const offer = await pc.createOffer({ iceRestart: this.iceRestart });
      if (!this.isCurrent(generation)) return;
      const sdp = safeSdpTransform(offer.sdp, source => {
        let value = source;
        if (this.settings.sdpHints) value = setVideoBandwidthHints(value, { chromium: /Chrom(e|ium)|Edg\//.test(navigator.userAgent) });
        if (this.settings.opusHints) value = configureOpusStereo(value, { sending: true });
        return value;
      });
      try { await pc.setLocalDescription({ type: 'offer', sdp }); }
      catch (error) {
        if (sdp === offer.sdp || pc.signalingState !== 'stable') throw error;
        await pc.setLocalDescription(offer); // validated interoperability fallback
      }
      if (!this.isCurrent(generation)) return;
      await emitWithAck(this.socket, 'webrtc:offer', this.envelope('offer', { sdp: pc.localDescription.sdp }, negotiationId));
      if (!this.isCurrent(generation)) return;
      this.iceRestart = false;
      this.candidatesReady = true;
      this.flushOutgoing();
      this.onState('negotiating');
    } catch (error) {
      if (this.isCurrent(generation)) { this.pending = false; this.onError(error); }
      throw error;
    }
  }
  async receiveOffer(message) {
    const generation = this.generation;
    if (this.role !== 'viewer' || !this.validMessage(message, 'offer')) return;
    this.answerQueue = this.answerQueue.catch(() => {}).then(async () => {
      if (!this.isCurrent(generation)) return;
      const pc = await this.ensurePeer(generation);
      if (!pc || !this.isCurrent(generation)) return;
      if (pc.signalingState !== 'stable') return; // host serializes offers
      this.negotiationId = message.negotiationId;
      this.remoteReady = false; this.candidatesReady = false; this.outboundCandidates = [];
      await pc.setRemoteDescription({ type: 'offer', sdp: message.payload.sdp });
      if (!this.isCurrent(generation)) return;
      this.remoteReady = true; await this.flushIncoming(message.negotiationId);
      const answer = await pc.createAnswer();
      if (!this.isCurrent(generation)) return;
      const sdp = this.settings.opusHints ? safeSdpTransform(answer.sdp, s => configureOpusStereo(s)) : answer.sdp;
      try { await pc.setLocalDescription({ type: 'answer', sdp }); }
      catch (error) {
        if (sdp === answer.sdp || pc.signalingState !== 'have-remote-offer') throw error;
        await pc.setLocalDescription(answer);
      }
      if (!this.isCurrent(generation)) return;
      await emitWithAck(this.socket, 'webrtc:answer', this.envelope('answer', { sdp: pc.localDescription.sdp }, message.negotiationId));
      if (!this.isCurrent(generation)) return;
      this.candidatesReady = true; this.flushOutgoing(); this.onState('negotiating');
    }).catch(e => { if (this.isCurrent(generation)) this.onError(e); });
    return this.answerQueue;
  }
  async receiveAnswer(message) {
    if (this.role !== 'host' || !this.validMessage(message, 'answer') || message.negotiationId !== this.negotiationId) return;
    const generation = this.generation;
    const pc = this.pc;
    if (!pc || pc.signalingState !== 'have-local-offer') return;
    try {
      await pc.setRemoteDescription({ type: 'answer', sdp: message.payload.sdp });
      if (!this.isCurrent(generation)) return;
      this.remoteReady = true; this.pending = false;
      await this.flushIncoming(message.negotiationId);
      // Some browsers cannot set encoding parameters before the first answer.
      await this.syncBitrate().catch(error => console.warn('Bitrate tuning unavailable:', error.name));
      if (this.wantsNegotiation) { this.wantsNegotiation = false; this.scheduleNegotiation(); }
    } catch (e) { if (this.isCurrent(generation)) this.onError(e); }
  }
  validMessage(message, type) {
    return message && message.roomId === this.roomId && message.connectionEpoch === this.epoch &&
      message.messageType === type && typeof message.negotiationId === 'string';
  }
  async receiveCandidate(message) {
    if (!this.validMessage(message, 'ice-candidate')) return;
    const id = message.negotiationId;
    const candidate = message.payload?.candidate;
    if (candidate !== null && (typeof candidate?.candidate !== 'string' || candidate.candidate.length > 2048)) return;
    const signature = `${id}:${candidate?.candidate || 'end'}:${candidate?.sdpMid || ''}`;
    if (this.seenCandidates.has(signature)) return;
    this.seenCandidates.add(signature);
    if (this.seenCandidates.size > 400) this.seenCandidates.clear();
    const list = this.inboundCandidates.get(id) || [];
    if (list.length >= 200) return;
    list.push(candidate); this.inboundCandidates.set(id, list);
    if (this.negotiationId === id && this.remoteReady) await this.flushIncoming(id);
  }
  async flushIncoming(id) {
    // Serial flushing preserves candidate ordering even if several events arrive together.
    const work = this.candidateChain.catch(() => {}).then(() => this.performFlushIncoming(id));
    this.candidateChain = work;
    return work;
  }
  async performFlushIncoming(id) {
    const generation = this.generation;
    while (this.remoteReady && this.pc && this.negotiationId === id && this.isCurrent(generation)) {
      const list = this.inboundCandidates.get(id);
      if (!list?.length) break;
      const item = list.shift();
      try { await this.pc.addIceCandidate(item); } catch (e) { console.warn('ICE candidate rejected:', e.name); }
    }
    if (!this.inboundCandidates.get(id)?.length) this.inboundCandidates.delete(id);
  }
  sendCandidate(candidate) {
    emitWithAck(this.socket, 'webrtc:ice-candidate', this.envelope('ice-candidate', { candidate })).catch(() => {});
  }
  flushOutgoing() { for (const candidate of this.outboundCandidates.splice(0)) this.sendCandidate(candidate); }
  async updateBitrate(bits) {
    this.targetBitrate = bits;
    return this.syncBitrate();
  }
  syncBitrate() {
    this.parameterQueue = this.parameterQueue.catch(() => {}).then(() => this.applyBitrate());
    return this.parameterQueue;
  }
  async applyBitrate() {
    const sender = this.videoTx?.sender;
    if (!sender?.track || !sender.getParameters) return;
    const params = sender.getParameters();
    if (!params.encodings?.length) return;
    params.encodings[0].maxBitrate = this.targetBitrate;
    params.encodings[0].maxFramerate = 60;
    params.degradationPreference = 'maintain-framerate';
    try { await sender.setParameters(params); }
    catch {
      const safe = sender.getParameters();
      if (!safe.encodings?.length) return;
      safe.encodings[0].maxBitrate = this.targetBitrate;
      await sender.setParameters(safe);
    }
    if (this.targetBitrate !== params.encodings[0].maxBitrate) return this.applyBitrate();
    const applied = sender.getParameters().encodings?.[0]?.maxBitrate;
    if (applied !== undefined && applied !== this.targetBitrate) {
      throw new Error('BITRATE_UNSUPPORTED');
    }
  }
  scheduleRecovery(generation, delay) {
    if (this.recoveryTimer) return;
    this.recoveryTimer = setTimeout(async () => {
      this.recoveryTimer = null;
      if (!this.isCurrent(generation) || !this.pc || this.pc.connectionState === 'connected') return;
      this.onState('recovering');
      if (this.role === 'host' && this.failures < 2) {
        this.failures++;
        try { await this.requestIceRestart(); } catch (e) { this.onError(e); }
        this.scheduleRecovery(generation, 10_000);
      } else if (this.role === 'viewer' && this.failures < 2) {
        this.failures++;
        emitWithAck(this.socket, 'webrtc:ice-restart-request', { connectionEpoch: this.epoch }).catch(() => {});
        this.scheduleRecovery(generation, 10_000);
      } else if (Date.now() - this.lastRebuild > 12_000) {
        this.lastRebuild = Date.now();
        emitWithAck(this.socket, 'peer:rebuild-request', { connectionEpoch: this.epoch }).catch(e => this.onError(e));
      }
    }, delay);
  }
  async requestIceRestart() {
    if (this.role !== 'host' || !this.pc) return;
    const generation = this.generation;
    const pc = this.pc;
    // Renew temporary TURN credentials for the next allocation before restarting ICE.
    try {
      const next = await api.ice(this.roomId);
      if (!this.isCurrent(generation) || this.pc !== pc) return;
      pc.setConfiguration({ ...pc.getConfiguration(), iceServers: next.iceServers,
        iceTransportPolicy: next.iceTransportPolicy });
    } catch (e) { console.warn('TURN credential refresh unavailable:', e.message); }
    if (!this.isCurrent(generation) || this.pc !== pc) return;
    this.iceRestart = true; pc.restartIce?.(); this.scheduleNegotiation();
  }
  restartRequested(message) {
    if (this.role === 'host' && message.connectionEpoch === this.epoch && this.pc) {
      this.requestIceRestart().catch(e => this.onError(e));
    }
  }
  destroyPeer() {
    clearTimeout(this.recoveryTimer); this.recoveryTimer = null;
    this.inboundCandidates.clear(); this.outboundCandidates = []; this.seenCandidates.clear();
    this.peerCreation = null; this.candidateChain = Promise.resolve();
    this.pending = false; this.wantsNegotiation = false; this.scheduled = false;
    this.negotiationId = null; this.remoteReady = false; this.candidatesReady = false;
    if (this.pc) { this.pc.onicecandidate = null; this.pc.ontrack = null;
      this.pc.onnegotiationneeded = null; this.pc.onconnectionstatechange = null; this.pc.close(); this.pc = null; }
    this.videoTx = null; this.audioTx = null;
    this.remoteStream.getTracks().forEach(t => this.remoteStream.removeTrack(t));
    if (this.role === 'viewer') this.onRemoteStream(this.remoteStream);
  }
  close() { this.closed = true; this.generation++; this.ready = false; this.destroyPeer(); }
}
