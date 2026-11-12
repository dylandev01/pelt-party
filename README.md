# Private Cinema

A private **one-host, one-viewer** theater powered by encrypted WebRTC display sharing. The host captures a chosen browser tab, application window or monitor **with playback audio where supported**. A Node/Express/Socket.IO server provides authentication and signaling, **not movie transport or media storage**. The viewer can watch from a desktop or compatible mobile browser while talking separately on the phone.

> Use only media you have permission to share. Browsers do not let this application capture DRM-protected video by circumventing protection. Sharing protected streams can appear black or fail.

## What is included

- Clean landing page, passworded room creation, one-time password display and private invitation links.
- Server-managed host/viewer credentials, HttpOnly session cookies, a single viewer slot, a room-end action, room TTLs, brute-force and signaling rate limits.
- Host-initiated offers, server-coordinated connection epochs, separate negotiation identifiers, incoming ICE candidate queues, stale-signal rejection and serialized SDP changes.
- Real `navigator.mediaDevices.getDisplayMedia()` only — **no microphone or webcam capture API**, no video calls or chat.
- Source replacement using `RTCRtpSender.replaceTrack()`, fallback screen capture settings, missing-audio warnings and visible permission recovery.
- Host bitrate slider (2–12 Mbps) with presets, 10 Mbps default, `RTCRtpSender.setParameters()` and optional SDP/Opus hints.
- Viewer autoplay/sound activation overlay, volume, mute, fullscreen, adaptive theater UI.
- Stats for Nerds from actual `RTCPeerConnection.getStats()` including codec, measured rates, FPS, reported resolution, packet loss where available, network RTT and selected relay/direct candidates.
- Automatic WebSocket reconnection, ICE restart and coordinated peer rebuild; separate Host capture and peer connection cleanup.
- Docker and Caddy configuration with optional Coturn or a compatible managed TURN provider.

## Quick start

**Requirement:** Node.js **24 LTS** and npm.

```bash
# In the private-cinema folder
npm install
cp .env.example .env
# For local testing, leave NODE_ENV=development and PUBLIC_ORIGIN=http://localhost:3000
npm run dev
```

Visit **http://localhost:3000**. Create a room and open the provided invite link in a **different browser or separate browser profile**. Enter the password shown on the Host page. Click **Start sharing** on the Host page, select a movie tab, turn on **Share tab audio** when the browser offers it, and start playback. The guest should use **Start watching with sound** if audible autoplay is blocked.

`localhost` is considered a secure context by browsers for development. Public deployment must use HTTPS.

**Dependency lockfile note:** The build environment used for this delivery could not reach the npm registry, so the initial archive contains `package.json` but **no registry-resolved `package-lock.json`**. The initial `npm install` command above generates it. Commit the generated lockfile, then use `npm ci` for repeatable installs. Do not use `npm ci` before a real lockfile exists.

## Deploy a **test** site on Render

The repository includes `render.yaml` for an HTTPS Node.js web service. **This is a test configuration**: it deliberately enables `ALLOW_STUN_ONLY_TEST_MODE=true` because a TURN server/secret is not supplied. It can connect on friendly networks but is *not* reliable across different NATs/mobile networks. Browser screen capture still requires manual user permission.

1. Create a **new GitHub repository for this project** (do not replace the unrelated Pelt Party app) and push the contents of `private-cinema/` as its repository root. The `render.yaml` file must be at the root.
2. Connect that repository in Render → New → Blueprint. Render can generate the `SESSION_SECRET` and assign an HTTPS `*.onrender.com` URL to `PUBLIC_ORIGIN` from its built-in `RENDER_EXTERNAL_URL` value.
3. Check `https://<your-render-host>/health`. It should respond with `{ "ok": true, "service": "private-cinema" }`. A deployment is not verified until this response is observed.
4. On two browsers, create a room, join with its one-time password, and try sharing a normal **non-DRM** tab with audio. Test on different networks after configuring a TURN provider.

To prepare for real use, configure `TURN_URL` (and optionally `TURN_TLS_URL`) plus `TURN_SHARED_SECRET` for a Coturn TURN REST-secret service. Set `ALLOW_STUN_ONLY_TEST_MODE=false` and redeploy. Do **not** put TURN shared secrets into Git or commit the production `.env` file. Render free instances may suspend when idle and cannot be relied on for uninterrupted watch sessions. For sustained use, switch to an always-on plan.

The app requires **one server instance** because rooms live in memory; scaling to multiple replicas breaks sessions. Render provides WebSocket-capable web services, but the platform does not host your UDP/TURN relay automatically. The WebRTC media is never carried by Render/Socket.IO; only signaling is.

## Architecture

```
Host browser  <---- authenticated signaling ---> Node/Express/Socket.IO <----> Viewer browser
      \                                                                /
       \------ encrypted DTLS-SRTP media via WebRTC (direct or TURN) ----/
```

Node validates cookies and signaling identities, manages presence and streams' **metadata only**, and forwards offers/answers/ICE candidates. It does not receive captured frames/audio. WebRTC performs media transport and native AV synchronization. When direct NAT traversal fails, **TURN forwards encrypted media packets**. Relayed mode is not physically peer-to-peer, although the media connection remains WebRTC-encrypted.

### Module map

| File | Responsibility |
|---|---|
| `src/server.js` | Express API, security middleware, Socket.IO server, cookie routes, cleanup |
| `src/config.js` | Environment variables, feature flags and deployment validation |
| `src/rooms.js` | In-memory room membership, session lifecycle, epochs and expiration |
| `src/auth.js` | Random tokens, HMAC token digests, scrypt passwords and cookie verification |
| `src/signaling.js` | Role-gated signaling, envelope validation, direct delivery, presence and coordinated rebuilds |
| `src/turn.js` | STUN and ephemeral Coturn REST TURN credentials |
| `public/js/main.js` | Room workflow and control wiring |
| `public/js/api.js` | Authenticated REST client |
| `public/js/socket.js` | Socket.IO client and activity heartbeat |
| `public/js/peer.js` | Single owner of `RTCPeerConnection`, candidate queue, negotiation, recovery, media tracks |
| `public/js/capture.js` | User-initiated display capture with separate track lifecycle |
| `public/js/sdp.js` | Pure safe SDP transformations and fallback |
| `public/js/stats.js` | Stats sampling and accurate deltas |
| `public/js/ui.js` | Theater status, user feedback and stats overlay |
| `public/js/utils.js` | Helpers, debounce, acknowledgment promises |

### WebRTC state and recovery

The host alone offers. A synchronized pair receives a **server epoch** (`peer:reset` then `peer:ready`). Every offer/answer/candidate message contains `{ roomId, connectionEpoch, negotiationId, senderInstanceId, messageType, payload }`. The server checks ownership and role; it never trusts a user-supplied role. The host coalesces renegotiation and only issues an offer when signaling state is stable. The viewer answers after installing the offer. Incoming ICE candidates are stored until the corresponding remote description is ready.

The Viewer refreshing retains its HttpOnly session credential. Its new socket replaces the old socket, and the server gives both peers a new epoch. The Host retains its captured `MediaStream` across **peer-connection** rebuilds and sends it again without reopening the capture picker. The Host **page** refreshing loses browser display-capture permission; it must click Share and reselect a tab. Temporary socket outages and ICE outages are distinct: ICE restart attempts are bounded, then a server-issued epoch coordinates rebuilding. All peer teardown leaves Host capture untouched. Once the host clicks Stop, capture tracks are stopped separately.

The room is stored in **one server instance's memory**. Restarting Node invalidates all rooms. Horizontal scaling is unsupported without shared session/room management and sticky/coordinated signaling. Ended/expired rooms and their credentials are invalidated.

### HTTP API

| Verb | Endpoint | Authorization |
|---|---|---|
| `POST` | `/api/rooms` | Rate-limited; creates room + Host cookie, returns plaintext password once |
| `POST` | `/api/rooms/:roomId/join` | Password required; viewer token cookie; full-room guard |
| `GET` | `/api/rooms/:roomId/status` | Authenticated Host or Viewer |
| `GET` | `/api/ice-config?roomId=...` | Authenticated Host or Viewer |
| `POST` | `/api/rooms/:roomId/leave` | Viewer only; releases seat and invalidates Viewer cookie |
| `DELETE` | `/api/rooms/:roomId` | Host only; ends room and disconnects peers |
| `GET` | `/health` | Public service health only |

REST errors are `{ "ok": false, "error": "ERROR_CODE" }`. Authenticated API responses have no-store cache headers. Room IDs are opaque; knowledge of an ID is **not** authorization. Cookies use `HttpOnly`, `SameSite=Strict`, path `/`, and `Secure` under production HTTPS.

### Socket.IO signaling contract

Socket connects with `auth: { roomId, instanceId }` and browser cookies. The **server derives Host/Viewer from HttpOnly cookies**, not from `auth.role` or message payloads. Emit events with acknowledgments `{ok:true}` or `{ok:false,error:"ERROR_CODE"}`. Max payload and rate limits apply.

| Event | Sender → recipient | Data |
|---|---|---|
| `room:ready` | Server → authenticated socket | Role, epoch, presence, stream state |
| `room:presence` | Server → both | Peer presence and stream state |
| `room:ended` | Server → both | Room permanently ended / viewer session left |
| `stream:state` | Host → Server → both | `{active:boolean,audio:boolean}`, revision assigned by server |
| `peer:reset`, `peer:ready` | Server → both | `{connectionEpoch}` |
| `peer:rebuild-request` | Either peer → Server | `{connectionEpoch}`; server throttles and rotates epochs |
| `webrtc:offer` | Host → Viewer | Validated negotiation envelope, `{sdp}` |
| `webrtc:answer` | Viewer → Host | Validated negotiation envelope, `{sdp}` |
| `webrtc:ice-candidate` | Either peer → opposite peer | Validated negotiation envelope, `{candidate}` or null end-of-candidates |
| `webrtc:ice-restart-request` | Viewer → Host | `{connectionEpoch}` |
| `room:activity` | Authenticated peer → Server | Keepalive to prevent idle expiry |

There are no room-wide offer/answer/ICE broadcasts. Room ownership, signaling epoch and negotiation IDs are validated on the server. Events outside the current session are rejected. Sender/receiver state is independently checked again in the browser after asynchronous calls.

## Video / audio quality

- Display capture requests **ideal** 1920×1080, **up to** 60 FPS, and motion content hint; real dimensions are read from the captured track.
- Default max video bitrate 10 Mbps, adjustable 2–12 Mbps. Presets: Data saver 2, Balanced 4, High 8, Ultra 12 Mbps. The selected limit is not actual throughput. WebRTC congestion control can send less.
- Compatible browser codecs are negotiated normally; a preference list can favor hardware-compatible H.264 without removing RTX/FEC codec support.
- Opus stereo hints are best-effort, never a promise of 256 kbps stereo. Browser/OS may return mono or silent audio even with an audio track.
- No multi-second custom buffers, server-side transcoding, artificial AV-sync delay or speech noise-suppression processing pipeline.
- Stats FPS may represent encoded/decoded FPS depending on browser reports. Network RTT **does not** equal end-to-end video delay. Missing values show `N/A`.

## Supported browsers and capture limitations

| Role | Preferred browsers | Notes |
|---|---|---|
| Host | Recent desktop Chrome / Edge | Prefer **Share a tab** and include tab audio; OS/system audio support varies |
| Viewer | Desktop Chrome / Edge | Best compatibility for receiving WebRTC video/audio |
| Viewer | Firefox / Safari | May need a manual playback/sound gesture; codec support varies |
| Viewer | Mobile Safari / Chrome | Playback/fullscreen UI depends on browser; mobile capture hosting not prioritized |

A browser cannot guarantee 1080p60, a specific codec or bitrate, exact latency, stereo, screen-audio availability, direct P2P, or DRM capture. A black protected movie is usually a DRM restriction, **not** something the app can repair. If no audio track comes back, the Host should restart capture and explicitly enable tab/system audio in a supported browser. Sharing the app's own tab may cause recursive mirroring: share the **movie** tab instead. The preview is hidden by default and is always muted.

## Environment variables

Copy `.env.example` and edit it. **Never commit `.env`.** Main variables:

| Name | Meaning |
|---|---|
| `NODE_ENV`, `PORT`, `PUBLIC_ORIGIN` | In production use HTTPS origin, e.g. `https://watch.example.com` |
| `SESSION_SECRET` | At least 32 random characters in production; `openssl rand -hex 32` |
| `STUN_URL` | Real STUN URL such as an authorized public STUN service |
| `TURN_URL`, `TURN_TLS_URL` | Coturn/managed TURN URLs, e.g. `turn:turn.example.com:3478?transport=udp` |
| `TURN_SHARED_SECRET` | Server-side Coturn `static-auth-secret` for HMAC-SHA1 REST credential scheme |
| `TURN_TTL_SECONDS` | Default 3600 seconds for temporary credential issuance |
| `TURN_FORCE_RELAY` | `true` for relay-only tests; **requires TURN** |
| `ROOM_IDLE_TTL_MINUTES`, `ROOM_MAX_TTL_HOURS` | Idle default 60 min, max 12 hours |
| `DEFAULT_VIDEO_BITRATE_BPS`, `MIN_VIDEO_BITRATE_BPS`, `MAX_VIDEO_BITRATE_BPS` | Bitrate default / bounds |
| `ENABLE_SDP_BITRATE_HINTS`, `ENABLE_OPUS_STEREO_HINTS`, `ENABLE_ADVANCED_CAPTURE_HINTS` | Feature flags |
| `WATCH_HOSTNAME` | Caddy hostname in Docker Compose, e.g. `watch.example.com` |

`TURN_SHARED_SECRET` is **never** sent to the browser; only short-lived username and HMAC credentials are sent to authorized users. Use NTP on both app and TURN servers. The STUN/TURN example domains in `.env.example` and Coturn config are placeholders, not real TURN services. Production config **fails at startup** without a valid session secret, HTTPS public origin and configured TURN URL/secret.

## Production: Linux VPS + Docker + HTTPS

1. Point an actual `A`/`AAAA` record for `watch.example.com` at the VPS public IP. Open TCP 80/443 (and UDP 443 if using HTTP/3). Install Docker Engine and Docker Compose plugin.
2. Copy the project onto the server. Create `.env` with `NODE_ENV=production`, `PUBLIC_ORIGIN=https://watch.example.com`, `WATCH_HOSTNAME=watch.example.com`, a strong `SESSION_SECRET`, and usable `TURN_URL` / `TURN_SHARED_SECRET` (see below).
3. Optionally run `npm install` once to generate and commit `package-lock.json` before building.
4. Start the HTTPS app:

   ```bash
   docker compose --env-file .env -f deploy/compose.yaml up -d --build
   docker compose --env-file .env -f deploy/compose.yaml logs -f
   ```

5. Open `https://watch.example.com` and check `https://watch.example.com/health`.

Caddy automatically provisions HTTPS certificates, redirects HTTP to HTTPS and forwards ordinary HTTPS and WebSocket requests to Node on an **internal-only** Docker network. No special WebSocket upgrade header hacks are required. Its certificate storage persists as Docker volumes. The web-facing port `3000` is not public in Compose. The Node process runs as the unprivileged `node` user in the image.

### Managed TURN

Use a compatible TURN provider that supports **ephemeral HMAC REST credentials** with a server-side shared secret (or adapt `src/turn.js` to the provider's official API/credential contract). Configure all TURN endpoint URLs, the matching secret, supported transports, and provider expiration details. Validate network reliability with relay-only mode. Do not paste permanent TURN passwords into public JavaScript.

### Self-hosted Coturn

`deploy/coturn.conf.example` is a template, **not a production-ready secret file**. Install Coturn on a public VPS or dedicated machine. Choose `turn.example.com` and a separate strong `static-auth-secret` matching `TURN_SHARED_SECRET` in the app. Set `realm`, `use-auth-secret`, `fingerprint`, UDP/TCP listener 3478, optional TLS listener 5349, and a bounded UDP relay range such as `49160–49260`. Provide certificates and time synchronization for TURNS. If the server is behind NAT, configure `external-ip` for public/private mapping. Keep the Coturn administration CLI off the public internet. Restrict unwanted peer destinations and keep the service patched.

Example Ubuntu UFW rules (**adjust to your setup**):

```bash
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp
sudo ufw allow 5349/tcp
sudo ufw allow 49160:49260/udp
```

TURN needs those network ports directly reachable: **ordinary reverse proxies for HTTP/WebSockets do not forward TURN UDP relay traffic.** For Cloudflare-managed DNS, the app's HTTPS hostname may be proxied where compatible, but the **TURN hostname should be DNS-only** (gray cloud) unless you have a specifically supported TURN proxy product.

### Testing a relay path

Set `TURN_FORCE_RELAY=true`, restart Node, create a **new** room and join from different networks. Start sharing, then inspect Stats for Nerds for **TURN Relay**. If it reports Unknown, inspect candidate pair support and server logs; do not assume TURN works just because TURN URLs were configured. Return to `TURN_FORCE_RELAY=false` to restore direct-first behavior.

## Testing

After installing dependencies:

```bash
npm test                   # Node room/auth/SDP tests plus Socket.IO integration
npx playwright install chromium
npm run test:browser       # Browser UI and synthetic-media WebRTC integration
```

The browser test uses a synthetic `canvas.captureStream()` and a Web Audio oscillator **only in a test-injected browser context**. That verifies wiring and negotiation, **not** actual desktop audio capture, mobile compatibility, cross-network TURN, or DRM. Playwright may need an operating-system/browser setup step to run headlessly.

### Manual end-to-end test matrix

| Case | Procedure | Pass criterion |
|---|---|---|
| A. Normal sharing | Chrome Host shares movie tab with sound to remote Viewer | Visible motion, audible sound after gesture, synchronized enough to watch |
| B. Missing audio | Share without tab audio, then change source | Both users see accurate no-audio warning; restart fixes when capture supports audio |
| C. Viewer refresh | Reload viewer while streaming | Viewer credential persists; Host retains screen capture; media resumes after negotiation |
| D. Host refresh | Reload Host | Viewer sees waiting; Host reselects source before resuming |
| E. Network interruption | Disconnect/reconnect viewer network | Bounded ICE recovery or coordinated reset; no duplicate tracks |
| F. TURN fallback | Enable relay-only mode from different networks | Receiver gets real stream; selected candidates report relay |
| G. Bitrate adjustment | Move slider from 10 to 4 to 12 Mbps | Sender ceiling updates where supported without reselecting screen |
| H. Rapid restarts | Start, stop, restart, change source repeatedly | No extra visible ghost streams or accumulating peer connections |
| I. Security | Wrong password, third viewer, stale token/socket | Denied; host can't be impersonated by viewer |
| J. Long watch | Stream an authorized video for ≥60 min | Room remains active, stats continue; track memory and audio sync |
| K. Cross-browser | Chrome→Chrome, Edge→Chrome, Chrome→Firefox/Safari/mobile | Note actual codec, autoplay, audio and fullscreen limitations |

A full manual production signoff requires exercising these tests on real browsers and distinct public networks.

## Troubleshooting

- **Black video**: If content is DRM-protected, the browser may block capture. Test with an authorized unprotected video or local playback.
- **No playback audio**: Prefer Chrome/Edge desktop, select a browser tab, and explicitly check **Share tab audio**. Confirm the Host warning disappears after restarting sharing. A returned audio track can still be silent.
- **Echo / doubled sound**: Host preview is muted. Ensure the original video tab is not also playing on the Viewer outside the app; do not enable phone audio from two speakers.
- **Infinite mirrors**: You accidentally shared the Private Cinema tab or entire monitor. Choose the movie tab instead. The `selfBrowserSurface` exclusion is a browser hint, not a guarantee.
- **Capture permission denied**: Allow OS screen recording permissions, click Start/Change source again, and select the display directly in the browser picker.
- **Video is pixelated or choppy**: Check actual FPS, selected ceiling and measured bitrate. Lower the bitrate preset or reduce source resolution if your upstream/CPU/GPU is limited.
- **Viewer hears nothing**: Click **Start watching with sound**. If Host did not capture an audio track, only restarting Host capture can fix it.
- **High packet loss / RTT**: Inspect Wi-Fi/uplink capacity, TURN routing, selected candidate type and browser stats. Network RTT is not full stream latency.
- **ICE failed**: Check STUN/TURN URL reachability, Coturn shared secret, firewall UDP relay ports, certificates and NAT `external-ip`. Try relay-only mode.
- **Reconnect not working**: Confirm both clients are authenticated, the server is reachable, room not expired, and peers receive a fresh epoch. If the Host browser tab reloaded, it must recapture manually.
- **Room expired**: Rooms are in-memory and have idle and absolute limits; start a fresh room after server restart or expiration.

## Security and privacy notes

- The server never stores/records/upload movie frames, decoded audio, movie titles, watch history or profiles.
- Passwords use salted `scrypt`; bearer session tokens are random and stored only as HMAC digests in memory. Session credentials and TURN shared secrets are not placed in public URLs, browser localStorage or production logs.
- WebRTC may reveal network addresses to the other peer according to browser privacy settings. A private room password is not IP anonymity. Relay-only transport is available for testing/privacy but can increase bandwidth cost and latency.
- Host and Viewer identity is validated on all sensitive endpoints and Socket.IO events. Use strong HTTPS, a well-provisioned TURN relay and correct `PUBLIC_ORIGIN` in production.
- This app intentionally has **no webcam, microphone, recording, storage, chat, user account, movie library or DRM circumvention** features.

## Deployment signoff checklist

- [ ] HTTPS certificate and WebSocket handshake work externally.
- [ ] A valid room and correct password admit exactly one viewer.
- [ ] Host can share a real browser tab **with audio** on the intended OS/browser.
- [ ] Viewer can enable sound when autoplay is blocked.
- [ ] Direct and forced-relay WebRTC paths have been tested across separate networks.
- [ ] Real stats accurately reflect candidate path, FPS and measured throughput.
- [ ] Viewer refresh and Host recapture work.
- [ ] Bitrate sliders do not disrupt the active stream.
- [ ] All production secrets are outside the repository; production config validates them.
- [ ] Idle/absolute expiration and end-room operations disconnect peers.
