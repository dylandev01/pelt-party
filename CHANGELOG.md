# Changelog

## 1.1.3 — October 6, 2026

- In-game “What’s new” patch notes page (`src/updates.js`), opened from the menu banner, the footer or a link on phones; the banner highlights unseen updates.
- Fixed legs bending sideways after respawning from a ragdoll (leftover knee twist); every joint the ragdoll touched is reset.
- Ragdoll feels less like jelly: muscle tone (slightly bent arms, legs under the hips, firmer neck), more solver iterations, more damping and a gentler launch.


## 1.1.2 — October 6, 2026

- Articulated ragdoll: 15 Verlet joint particles (pelvis, neck, head, shoulders, elbows, hands, hips, knees, feet) with bone constraints, a rigid torso, a floppy neck and elbow/knee fold limits; each particle collides with the ground and slides with friction. The rig's real joints are rotated every frame to follow the simulation, so every limb flops independently. Throws and Big Pelt splashes knock nearby ragdolls around.


## 1.1.1 — October 6, 2026

- Dive, slide and ragdoll no longer sink into the ground (rotation around the feet, per-frame ground check against the real geometry).
- Real physics ragdoll: rigid body with gravity, spin, bounce and friction colliding on sampled body geometry; arms, legs and head are gravity-driven damped springs. Bodies tumble, skid about 2 m and settle in about 2 seconds in varied poses.


## 1.1.0 — October 6, 2026 — accounts and goals

- Username/password accounts (PBKDF2-SHA256, hashed session tokens, lockout, per-IP sign-up limit) on new `Account` and `Leaderboard` Durable Objects (migration v2).
- Server-owned progress: coins, XP, levels, unlocks, equipped look, lifetime stats; purchases and equips validated on the server.
- Online rooms credit signed-in players from their own results; bot matches are clamped, spaced and capped.
- Daily (3) and weekly (2) challenges, 11 achievements with exclusive hats, daily login streak, level-up coins, global ranks.
- New Account, Challenges and Ranks screens; results show server-confirmed rewards and claimable goals.
- Ragdoll deaths that land flat on the ground, stars, a bounce sound, a "SPLATTED!" death screen with the killer, countdown and tips, and a circling death camera.
- Settings shows the frame rate the browser is actually delivering and how to unlock 144/240 Hz.


## 1.0.0 — October 6, 2026 — the big rework

- **Move set**: 2-charge dive with invulnerability frames, slide (crouch while sprinting), crouch cover, slippery ice; faster run/sprint; knockback on hit.
- **Quick cover**: `Q` builds a curved three-segment wall that rises from the ground, absorbs hits and crumbles; replaces the old 3-ammo fort.
- **Pacing**: faster, flatter throws that keep flying past the aim point, 260 ms throw cooldown, 0.55 s charge, 8 ammo, scoop-anywhere ammo, faster piles, 2.2 s respawn with spawn protection at the safest spawn, a 30-second Blizzard finale.
- **Power pads** show their power and rotate: Triple Toss, Snow Shield, Hot Cocoa, Giga Ball, Sugar Rush (auto-applied on touch).
- **Competitive feedback**: streaks, multi-splats, first splat, shutdown and payback callouts; kill feed, hit markers, damage direction, hit-stop, scoreboard, race bar, minimap, end-of-match awards.
- **Maps**: four authored arenas (Frosty Commons, Maple Street, Pumpkin Patch, Haunted Hollow) with backdrops (skyline, houses, cornfield, crypts) and seasonal dressing; 20% larger for 13+ players.
- **Bots**: target scoring, strafing at range, leading shots, dodge dives, defensive walls, scooping, pickup hunting, unsticking.
- **Renderer**: quality presets, FPS cap or unlimited, render scale, PCF shadows, sky gradient, falling snow/leaves/embers, pelt trails, splat decals, instanced effects; removed full-screen blur filters.
- **UI**: new menu over a live bot match, play setup with map cards, Locker with 3D preview, tabbed Settings, pause menu, lobby, results with awards, XP and levels, phone layouts.
- **Audio**: synthesised seasonal menu and battle music with Blizzard intensity, new sound effects with stereo panning.
- **Content**: 10 chibi looks and 12 hats built on the supplied rig; new dive/slide/scoop/build/charge poses.
- Tests rewritten for the new rules; browser smoke test rewritten for the new UI.


## 0.1.0 — October 6, 2026

- Created the standalone Pelt Party project and Cloudflare Worker/Durable Object backend.
- Added pure shared room rules, binary movement, local bots, reconnects, countdowns and opt-in public bot fill.
- Imported the owner's original chibi modules and required appearance/toolbox helpers; added fight poses and four hats.
- Built procedural seasonal scenes, three prototype maps/modes, basic combat/forts/pickups, results, responsive menus and touch/gamepad input.
- Added geometry-derived LOD, instanced effects, local practice progression, wardrobe and season previews.
- Added rules tests, a simulated room workload, actual local WebSocket integration checks and browser smoke tests.
- Recorded limitations and remaining milestones in STATUS.md. Production deployment and real-device acceptance remain open.

- Fixed reconnect identity checks for reused seats, roll movement validation, ground z-fighting, mobile home scrolling, player labels and team result ranking.
- Reduced the supplied animation module to idle, walk, run and pose blending; removed unused paired gestures, photo booth/bed sequences, garden props and their rig hooks before GitHub publication.
