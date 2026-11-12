import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCodecPayloadTypes, findMediaSection, validateSdpStructure, upsertFmtpParameter,
  configureOpusStereo, setVideoBandwidthHints, safeSdpTransform } from '../public/js/sdp.js';

const SAMPLE = [
  'v=0','o=- 1 1 IN IP4 127.0.0.1','s=-','t=0 0', 'a=group:BUNDLE 0 1',
  'm=audio 9 UDP/TLS/RTP/SAVPF 109','c=IN IP4 0.0.0.0','a=mid:0','a=rtpmap:109 opus/48000/2','a=fmtp:109 minptime=10;useinbandfec=1',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97', 'c=IN IP4 0.0.0.0','a=mid:1', 'a=rtpmap:96 VP8/90000', 'a=rtpmap:97 rtx/90000','a=fmtp:97 apt=96'
].join('\r\n') + '\r\n';

test('finds sections and dynamic codec payload without hardcoded 111', () => {
  assert.deepEqual(findCodecPayloadTypes(SAMPLE, 'audio', 'opus'), ['109']);
  assert.deepEqual(findCodecPayloadTypes(SAMPLE, 'video', 'VP8'), ['96']);
  assert.ok(findMediaSection(SAMPLE, 'video').startsWith('m=video'));
  assert.equal(findMediaSection(SAMPLE, 'application'), null);
});
test('Opus configuration preserves unrelated FMTP and avoids duplicate keys', () => {
  const once = configureOpusStereo(SAMPLE);
  const twice = configureOpusStereo(once);
  assert.ok(twice.includes('minptime=10'));
  assert.equal((twice.match(/stereo=1/g) || []).length, 1);
  assert.equal((twice.match(/maxaveragebitrate=256000/g) || []).length, 1);
  assert.equal(twice.includes('a=fmtp:97 apt=96'), true);
  assert.ok(twice.endsWith('\r\n'));
});
test('sender Opus hints declare likely stereo without receiver cap', () => {
  const result = configureOpusStereo(SAMPLE, { sending: true });
  assert.ok(result.includes('sprop-stereo=1'));
  assert.ok(!result.includes('maxaveragebitrate=256000'));
});
test('inserts bandwidth once in video media, preserving audio and SDP media order', () => {
  const once = setVideoBandwidthHints(SAMPLE, { chromium: true });
  const twice = setVideoBandwidthHints(once, { chromium: true });
  assert.equal((twice.match(/b=TIAS:/g) || []).length, 1);
  assert.ok(twice.indexOf('m=video') < twice.indexOf('c=IN IP4 0.0.0.0', twice.indexOf('m=video')));
  assert.ok(twice.indexOf('c=IN IP4 0.0.0.0', twice.indexOf('m=video')) < twice.indexOf('b=TIAS'));
  assert.equal(findMediaSection(twice, 'audio'), findMediaSection(SAMPLE, 'audio'));
  assert.ok(twice.includes('a=fmtp:97 apt=96'));
});
test('handles absent media type and synthesizes missing FMTP', () => {
  const videoOnly = SAMPLE.slice(0, SAMPLE.indexOf('m=audio')) + SAMPLE.slice(SAMPLE.indexOf('m=video'));
  assert.equal(configureOpusStereo(videoOnly), videoOnly);
  const noFmtp = SAMPLE.replace('a=fmtp:109 minptime=10;useinbandfec=1\r\n', '');
  assert.ok(configureOpusStereo(noFmtp).includes('a=fmtp:109 stereo=1'));
  assert.ok(upsertFmtpParameter(SAMPLE, 'video', '96', 'test', '1').includes('a=fmtp:96 test=1'));
});
test('malformed SDP falls back to original', () => {
  assert.equal(validateSdpStructure('not sdp'), false);
  assert.equal(safeSdpTransform('bad', s => setVideoBandwidthHints(s)), 'bad');
  assert.throws(() => setVideoBandwidthHints(SAMPLE, { tias: 1 }));
});
