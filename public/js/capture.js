export class CaptureManager {
  constructor({ onEnded = () => {}, advanced = true } = {}) {
    this.stream = null; this.onEnded = onEnded; this.advanced = advanced; this.revision = 0;
  }
  async choose() {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new DOMException('Unsupported', 'NotSupportedError');
    // Must be invoked immediately during the original click gesture. No awaited API calls beforehand.
    const options = this.advanced ? {
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60, max: 60 }, displaySurface: 'browser' },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        sampleRate: { ideal: 48000 }, channelCount: { ideal: 2 }, suppressLocalAudioPlayback: false },
      preferCurrentTab: false, selfBrowserSurface: 'exclude', systemAudio: 'include',
      surfaceSwitching: 'include', monitorTypeSurfaces: 'include'
    } : { video: true, audio: true };
    try {
      const candidate = await navigator.mediaDevices.getDisplayMedia(options);
      const video = candidate.getVideoTracks()[0];
      if (!video || video.readyState !== 'live') { candidate.getTracks().forEach(t => t.stop()); throw new DOMException('No video track', 'NotReadableError'); }
      try { video.contentHint = 'motion'; } catch { /* unsupported */ }
      // Don't stop the previous working capture until the new source has been integrated by the caller.
      const generation = ++this.revision;
      video.addEventListener('ended', () => {
        if (this.revision === generation && this.stream?.getVideoTracks()[0] === video) this.onEnded();
      }, { once: true });
      return candidate;
    } catch (error) {
      if (error.name === 'TypeError') this.advanced = false;
      throw error;
    }
  }
  accept(candidate) { const previous = this.stream; this.stream = candidate; if (previous !== candidate) previous?.getTracks().forEach(t => t.stop()); }
  stop() { this.revision++; this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; }
  get audioAvailable() { return Boolean(this.stream?.getAudioTracks().some(t => t.readyState === 'live')); }
  get videoSettings() { return this.stream?.getVideoTracks()[0]?.getSettings?.() || {}; }
}
