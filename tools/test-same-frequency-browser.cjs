// Requires Playwright and a running Party Hall server.
// node tools/test-same-frequency-browser.cjs [http://localhost:8080]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const BASE = process.argv[2] || 'http://localhost:8080';
const OUT = process.env.OUT || '/tmp/same-frequency-qa';
fs.mkdirSync(OUT, { recursive: true });
const source = fs.readFileSync(path.join(__dirname, 'audit.js'), 'utf8');
const audit = {};
vm.runInNewContext(source.slice(source.indexOf('const CHECK ='), source.indexOf('async function auditGame')) + ';this.check=CHECK;', audit);
function instrument() {
  const AC = window.AudioContext;
  if (AC) window.AudioContext = class extends AC {
    constructor(...args) { super(...args); (window.__audioContexts ||= []).push(this); }
    createGain() { const g = super.createGain(); (this.__gains ||= []).push(g); return g; }
    createOscillator() { this.__notes = (this.__notes || 0) + 1; return super.createOscillator(); }
  };
  const WS = window.WebSocket;
  window.WebSocket = class extends WS {
    constructor(...args) {
      super(...args); window.__sfSocket = this;
      this.addEventListener('message', (event) => {
        const m = JSON.parse(event.data);
        if (m.data?.view?.sf) {
          window.__sf = m.data.view.sf;
          (window.__sfHistory ||= []).push(m.data.view.sf);
        }
      });
    }
  };
}
const view = (p) => p.evaluate(() => window.__sf);
async function phase(p, expected, round) {
  await p.waitForFunction(({ expected, round }) => window.__sf?.phase === expected && (round === undefined || window.__sf.round === round), { expected, round });
}
async function check(page, tv, label) {
  await page.waitForTimeout(500);
  const report = await page.evaluate(audit.check, tv);
  await page.screenshot({ path: `${OUT}/${label}.png`, fullPage: !tv });
  assert.equal(report.zoom, 1, JSON.stringify(report));
  for (const key of ['outside', 'clipped', 'contrast', 'small']) assert.deepEqual(report[key], [], `${label} ${key}: ${JSON.stringify(report)}`);
  if (tv) assert.ok(await page.evaluate(() => [...document.querySelectorAll('.sf-host button')].every((b) => {
    const r = b.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit === b || b.contains(hit);
  })), `${label}: game controls must be unobstructed`);
}
async function play(browser, n) {
  const contexts = [], errors = [];
  async function page(width, height) {
    const c = await browser.newContext({ viewport: { width, height } }); contexts.push(c);
    await c.addInitScript(instrument);
    const p = await c.newPage(); p.on('pageerror', (e) => errors.push(e.message)); return p;
  }
  try {
    const host = await page(1920, 1080);
    await host.goto(BASE + '/host');
    await host.getByRole('button').filter({ hasText: 'Same Frequency' }).click();
    const code = await host.locator('.roomcode').textContent();
    const phones = [];
    for (let i = 0; i < n; i++) {
      const p = await page(i === 0 ? 320 : 390, 844);
      await p.goto(BASE + '/?code=' + code);
      await p.locator('input[autocomplete=nickname]').fill(i === 0 ? 'VeryLongNameHere!' : `Listener ${i + 1}`);
      await p.locator('button[type=submit]').click(); phones.push(p);
    }
    await host.waitForFunction((count) => document.querySelectorAll('.chip').length === count, n);
    await host.getByRole('button', { name: "Everybody's in!" }).click();
    await host.locator('.sf-intro').waitFor();
    await check(host, true, `${n}-intro`);
    await host.waitForFunction(() => window.__audioContexts?.at(-1).__notes > 0);
    if (n === 3) {
      await host.locator('.hostbar button[title="Sound on/off"]').click();
      await host.waitForFunction(() => window.__audioContexts.at(-1).__gains[0].gain.value < .005);
      await host.locator('.hostbar button[title="Sound on/off"]').click();
      await host.waitForFunction(() => window.__audioContexts.at(-1).__gains[0].gain.value > .29);
    }
    await phase(phones[0], 'setup'); await check(phones[0], false, `${n}-phone-intro`);
    await host.getByRole('button', { name: 'Let’s tune in →' }).click();
    for (let round = 0; round < n; round++) {
      await phase(phones[0], 'clue', round);
      await Promise.all(phones.map((p) => phase(p, 'clue', round)));
      const views = await Promise.all(phones.map(view));
      const djIndex = views.findIndex((v) => v.giving), dj = phones[djIndex];
      const target = views[djIndex].target;
      for (const [i, v] of views.entries()) if (i !== djIndex) assert.equal(v.target, undefined);
      assert.equal(await host.locator('.sf-target').count(), 0);
      if (round === 0) {
        await check(host, true, `${n}-clue`); await check(dj, false, `${n}-dj`);
        await check(phones[(djIndex + 1) % n], false, `${n}-waiting`);
      }
      await dj.getByRole('textbox', { name: 'Your clue' }).fill(round === 0 ? 'Your wedding cake arrives frozen.' : 'A surprisingly specific example.');
      await dj.getByRole('button', { name: 'Send the clue →' }).click();
      await Promise.all(phones.map((p) => phase(p, 'guess', round)));
      const guessers = phones.filter((_, i) => i !== djIndex);
      if (round === 0) {
        await check(host, true, `${n}-guess`); await check(guessers[0], false, `${n}-phone-guess`);
        // Slider updates animate the existing needle, preserving continuity.
        await guessers[0].evaluate(() => { window.__needle = document.querySelector('.sf-needle'); });
        await guessers[0].locator('input[type=range]').fill('73');
        assert.ok(await guessers[0].evaluate(() => window.__needle === document.querySelector('.sf-needle')));
        const p = guessers[0];
        await p.context().setOffline(true); await p.evaluate(() => window.__sfSocket.close());
        await host.waitForTimeout(300); await p.context().setOffline(false); await p.reload();
        await phase(p, 'guess', round); assert.equal((await view(p)).target, undefined);
      }
      // Submit concurrently to exercise the twelve-player relay budget.
      await Promise.all(guessers.map(async (p) => {
        await p.locator('input[type=range]').fill(String(target));
        await p.getByRole('button', { name: 'Save my guess →' }).click();
      }));
      await Promise.all(phones.map((p) => phase(p, 'debate', round)));
      assert.equal(await host.locator('.sf-target').count(), 0);
      if (round === 0) {
        await check(host, true, `${n}-debate`); await check(guessers[0], false, `${n}-phone-debate`);
        await guessers[0].locator('input[type=range]').fill(String(Math.max(0, target - 2)));
        await guessers[0].getByRole('button', { name: 'Update my guess →' }).click();
        await guessers[0].waitForFunction((guess) => window.__sf.mine === guess, Math.max(0, target - 2));
        assert.ok((await guessers[0].evaluate(() => window.__sfHistory)).every((v) => v.round !== round || v.target === undefined));
      }
      await dj.getByRole('button', { name: 'Reveal the signal →' }).click();
      await Promise.all(phones.map((p) => phase(p, 'reveal', round)));
      assert.equal((await view(guessers[0])).target, target);
      if (round === 0) {
        await host.waitForTimeout(1200); await check(host, true, `${n}-reveal`);
        await check(guessers[0], false, `${n}-phone-reveal`);
      }
      const current = await view(dj);
      assert.ok(current.result.points.every((p) => p.gain === 4));
      await host.getByRole('button', { name: round + 1 === n ? 'Final standings →' : 'Next DJ →' }).click();
    }
    await host.locator('.sf-finish').waitFor();
    await check(host, true, `${n}-finished`);
    await phase(phones[0], 'finished'); await check(phones[0], false, `${n}-phone-finished`);
    assert.equal(await host.locator('.sf-final-row').count(), n);
    await host.getByRole('button', { name: 'Back to the lobby' }).click();
    await host.getByRole('button', { name: "Everybody's in!" }).waitFor();
    await host.waitForTimeout(400);
    assert.equal(await host.locator('link[href$="same-frequency/style.css"]').count(), 0);
    assert.equal(await host.evaluate(() => window.__audioContexts.at(-1).state), 'closed');
    assert.equal(await phones[0].locator('.sf-phone').count(), 0);
    assert.deepEqual(errors, []);
    console.log(`${n} players: full game, concurrent submissions, target secrecy, reconnect, scoring, layout and cleanup passed.`);
  } finally { await Promise.all(contexts.map((c) => c.close())); }
}
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  try { await play(browser, 3); await play(browser, 12); }
  finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
