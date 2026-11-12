import { formatRate, formatSize } from './utils.js';
export class StatsSampler {
  constructor(peer, onUpdate) { this.peer = peer; this.onUpdate = onUpdate; this.previous = new Map(); this.timer = null; this.busy = false; this.pc = null; }
  start() { if (this.timer) return; this.timer = setInterval(() => this.sample(), 1000); this.sample(); }
  stop() { clearInterval(this.timer); this.timer = null; this.previous.clear(); this.pc = null; }
  async sample() {
    const pc = this.peer.pc;
    if (!pc || this.busy || pc.connectionState === 'closed') return;
    if (pc !== this.pc) { this.pc = pc; this.previous.clear(); }
    this.busy = true;
    try {
      const report = await pc.getStats();
      if (this.peer.pc !== pc) return;
      const kind = this.peer.role === 'host' ? 'outbound-rtp' : 'inbound-rtp';
      const data = { videoRate: null, audioRate: null, fps: null, size: 'N/A', codec: 'N/A',
        loss: null, rtt: null, transport: 'Unknown', ice: pc.iceConnectionState,
        ceiling: this.peer.role === 'host' ? this.peer.targetBitrate : null };
      for (const row of report.values()) {
        if (row.type !== kind || row.isRemote) continue;
        const medium = row.kind || row.mediaType;
        if (!['audio', 'video'].includes(medium)) continue;
        const previous = this.previous.get(row.id);
        const bytes = this.peer.role === 'host' ? row.bytesSent : row.bytesReceived;
        const olderBytes = previous?.bytes;
        const elapsed = (row.timestamp - (previous?.time || row.timestamp)) / 1000;
        const rate = elapsed > 0 && bytes >= olderBytes ? 8 * (bytes - olderBytes) / elapsed : null;
        this.previous.set(row.id, { bytes, time: row.timestamp, frames: row.framesEncoded ?? row.framesDecoded,
          packets: row.packetsReceived, lost: row.packetsLost });
        if (medium === 'video') {
          data.videoRate = rate;
          data.size = formatSize(row.frameWidth, row.frameHeight);
          data.fps = row.framesPerSecond ?? (previous && elapsed > 0 ?
            ((row.framesEncoded ?? row.framesDecoded) - previous.frames) / elapsed : null);
          const codec = report.get(row.codecId);
          if (codec?.mimeType) data.codec = codec.mimeType.replace(/^video\//, '');
          if (this.peer.role === 'viewer' && previous && elapsed > 0) {
            const lost = row.packetsLost - previous.lost;
            const received = row.packetsReceived - previous.packets;
            if (lost >= 0 && received >= 0 && lost + received > 0) data.loss = 100 * lost / (received + lost);
          }
        } else data.audioRate = rate;
      }
      for (const row of report.values()) {
        if (row.type === 'remote-inbound-rtp' && row.kind === 'video') {
          if (data.rtt == null && Number.isFinite(row.roundTripTime)) data.rtt = row.roundTripTime * 1000;
        }
        if (row.type !== 'transport') continue;
        const selected = report.get(row.selectedCandidatePairId);
        if (!selected) continue;
        if (Number.isFinite(selected.currentRoundTripTime)) data.rtt = selected.currentRoundTripTime * 1000;
        const local = report.get(selected.localCandidateId), remote = report.get(selected.remoteCandidateId);
        if (local && remote) data.transport = local.candidateType === 'relay' || remote.candidateType === 'relay' ? 'TURN Relay' : 'Direct P2P';
      }
      this.onUpdate({ ...data, videoLabel: formatRate(data.videoRate), audioLabel: formatRate(data.audioRate) });
    } catch { this.onUpdate({ unavailable: true }); }
    finally { this.busy = false; }
  }
}
