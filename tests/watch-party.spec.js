import { test, expect } from '@playwright/test';

test('create, reject bad passwords, admit only one viewer, change bitrate, then end room', async ({ browser }) => {
  const host = await browser.newContext();
  const guest = await browser.newContext();
  const third = await browser.newContext();
  try {
    const h = await host.newPage(), v = await guest.newPage(), extra = await third.newPage();
    await h.goto('/');
    await expect(h.getByRole('heading', { name: /movie magic/i })).toBeVisible();
    await h.getByRole('button', { name: /create your private theater/i }).click();
    await expect(h.getByRole('heading', { name: /director's room/i })).toBeVisible();
    const invitation = await h.locator('#inviteLink').inputValue();
    const password = await h.locator('#roomPassword').inputValue();
    expect(password.length).toBeGreaterThanOrEqual(8);
    await v.goto(invitation);
    await v.locator('#viewerPassword').fill('wrong password');
    await v.locator('#joinRoom').click();
    await expect(v.locator('#joinError')).toContainText(/not correct/i);
    await v.locator('#viewerPassword').fill(password);
    await v.locator('#joinRoom').click();
    await expect(v.locator('#viewerExperience')).toBeVisible();
    await expect(h.locator('#viewerPresence')).toContainText(/guest is here/i);
    await extra.goto(invitation);
    await extra.locator('#viewerPassword').fill(password);
    await extra.locator('#joinRoom').click();
    await expect(extra.locator('#joinError')).toContainText(/already has a viewer/i);
    await h.locator('#bitrateSlider').fill('4000000');
    await expect(h.locator('#bitrateValue')).toHaveText('4.0 Mbps');
    await h.locator('#hostStatsToggle').click();
    await expect(h.locator('#statsPanel')).toBeVisible();
    h.once('dialog', dialog => dialog.accept());
    await h.locator('#endRoom').click();
    await expect(v).toHaveURL('http://localhost:3000/');
  } finally { await Promise.all([host.close(), guest.close(), third.close()]); }
});

test('viewer can refresh using session cookie and host retains its room', async ({ browser }) => {
  const host = await browser.newContext(), guest = await browser.newContext();
  try {
    const h = await host.newPage(), v = await guest.newPage();
    await h.goto('/'); await h.locator('#createRoom').click();
    const invitation = await h.locator('#inviteLink').inputValue();
    const password = await h.locator('#roomPassword').inputValue();
    await v.goto(invitation); await v.locator('#viewerPassword').fill(password); await v.locator('#joinRoom').click();
    await expect(v.locator('#viewerExperience')).toBeVisible();
    await v.reload(); await expect(v.locator('#viewerExperience')).toBeVisible();
    await h.reload(); await expect(h.locator('#host')).toBeVisible();
    await expect(h.locator('#roomPassword')).toHaveValue('');
  } finally { await Promise.all([host.close(), guest.close()]); }
});

test('test-only synthetic media can negotiate between browsers without a microphone', async ({ browser }) => {
  const host = await browser.newContext(), guest = await browser.newContext();
  try {
    // Test-only substitute for OS screen picker. Real display/system audio must be verified manually.
    await host.addInitScript(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
        const ctx = canvas.getContext('2d'); let tick = 0;
        window.__testFrame = setInterval(() => { ctx.fillStyle = tick++ % 2 ? '#334488' : '#664488'; ctx.fillRect(0, 0, 640, 360); }, 100);
        const stream = canvas.captureStream(10);
        const audioContext = new AudioContext(); const oscillator = audioContext.createOscillator();
        const destination = audioContext.createMediaStreamDestination(); oscillator.connect(destination); oscillator.start();
        stream.addTrack(destination.stream.getAudioTracks()[0]); return stream;
      };
    });
    const h = await host.newPage(), v = await guest.newPage();
    await h.goto('/'); await h.locator('#createRoom').click();
    const invitation = await h.locator('#inviteLink').inputValue(), password = await h.locator('#roomPassword').inputValue();
    await v.goto(invitation); await v.locator('#viewerPassword').fill(password); await v.locator('#joinRoom').click();
    await h.locator('#startSharing').click();
    await expect(h.locator('#hostStatusPill')).toContainText(/streaming live|ready to connect/i, { timeout: 20_000 });
    await expect.poll(async () => v.locator('#remoteVideo').evaluate(video => video.srcObject?.getVideoTracks().length || 0), { timeout: 20_000 }).toBeGreaterThan(0);
  } finally { await Promise.all([host.close(), guest.close()]); }
});
