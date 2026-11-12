// Pure SDP transformers: never edit ICE credentials, DTLS fingerprints, mids, groups, or unrelated sections.
function split(sdp) {
  if (typeof sdp !== 'string' || !sdp.startsWith('v=0')) throw new TypeError('Not SDP');
  const lines = sdp.replace(/\r?\n/g, '\n').split('\n').filter(Boolean);
  if (!lines.some(line => /^m=(audio|video) /.test(line))) throw new TypeError('Missing media sections');
  const sections = [{ kind: 'session', lines: [] }];
  for (const line of lines) {
    if (line.startsWith('m=')) sections.push({ kind: line.split(/[ =]/)[1], lines: [line] });
    else sections.at(-1).lines.push(line);
  }
  return sections;
}
function serialize(sections) { return sections.flatMap(section => section.lines).join('\r\n') + '\r\n'; }
export function validateSdpStructure(sdp) { try { return split(sdp).some(s => s.kind === 'audio' || s.kind === 'video'); } catch { return false; } }
export function findMediaSection(sdp, kind) { return split(sdp).find(s => s.kind === kind)?.lines.join('\r\n') || null; }
export function findCodecPayloadTypes(sdp, kind, codec) {
  const section = split(sdp).find(s => s.kind === kind);
  if (!section) return [];
  return section.lines.flatMap(line => {
    const match = /^a=rtpmap:(\d+)\s+([^/\s]+)/i.exec(line);
    return match && match[2].toLowerCase() === codec.toLowerCase() ? [match[1]] : [];
  });
}
function applyToMedia(sdp, kind, updater) {
  const sections = split(sdp);
  const section = sections.find(s => s.kind === kind);
  if (!section) return sdp;
  updater(section.lines);
  return serialize(sections);
}
function upsertLineParameter(lines, pt, key, value) {
  const matcher = new RegExp(`^a=fmtp:${pt}\\s+`);
  let index = lines.findIndex(line => matcher.test(line));
  if (index < 0) {
    const rtpmap = lines.findIndex(line => line.startsWith(`a=rtpmap:${pt} `));
    if (rtpmap < 0) return;
    index = rtpmap + 1; lines.splice(index, 0, `a=fmtp:${pt} ${key}=${value}`); return;
  }
  const original = lines[index];
  const map = new Map();
  for (const part of original.replace(matcher, '').split(';')) {
    const [k, ...v] = part.trim().split('='); if (k) map.set(k.toLowerCase(), v.join('='));
  }
  map.set(key.toLowerCase(), String(value));
  lines[index] = `a=fmtp:${pt} ${[...map].map(([k, v]) => v === '' ? k : `${k}=${v}`).join(';')}`;
}
export function upsertFmtpParameter(sdp, kind, pt, key, value) {
  return applyToMedia(sdp, kind, lines => upsertLineParameter(lines, pt, key, value));
}
export function configureOpusStereo(sdp, { sending = false } = {}) {
  const pts = findCodecPayloadTypes(sdp, 'audio', 'opus');
  return applyToMedia(sdp, 'audio', lines => {
    for (const pt of pts) {
      upsertLineParameter(lines, pt, sending ? 'sprop-stereo' : 'stereo', 1);
      if (!sending) upsertLineParameter(lines, pt, 'maxaveragebitrate', 256000);
      upsertLineParameter(lines, pt, 'useinbandfec', 1);
      upsertLineParameter(lines, pt, 'usedtx', 0);
    }
  });
}
export function setVideoBandwidthHints(sdp, { tias = 12_000_000, chromium = false, start = 8000, max = 12000 } = {}) {
  if (!Number.isInteger(tias) || tias < 100_000 || tias > 100_000_000) throw new TypeError('Invalid TIAS');
  const codecs = chromium ? ['VP8', 'VP9', 'H264'].flatMap(codec => findCodecPayloadTypes(sdp, 'video', codec)) : [];
  return applyToMedia(sdp, 'video', lines => {
    const mediaIndex = lines.findIndex(l => l.startsWith('m=video '));
    if (mediaIndex < 0) return;
    for (let i = lines.length - 1; i > mediaIndex; i--) if (/^b=(TIAS|AS):/.test(lines[i])) lines.splice(i, 1);
    const connectionIndex = lines.findIndex((l, i) => i > mediaIndex && l.startsWith('c='));
    lines.splice((connectionIndex >= 0 ? connectionIndex : mediaIndex) + 1, 0, `b=TIAS:${tias}`);
    for (const pt of codecs) {
      upsertLineParameter(lines, pt, 'x-google-start-bitrate', start);
      upsertLineParameter(lines, pt, 'x-google-max-bitrate', max);
    }
  });
}
export function safeSdpTransform(original, transform) {
  try { const updated = transform(original); return validateSdpStructure(updated) ? updated : original; }
  catch { return original; }
}
