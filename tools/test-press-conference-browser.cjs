// Requires Playwright and a running Party Hall server.
// node tools/test-press-conference-browser.cjs [http://localhost:8080]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const BASE = process.argv[2] || 'http://localhost:8080';
const OUT = process.env.OUT || '/tmp/press-conference-qa';
fs.mkdirSync(OUT, { recursive: true });
const source = fs.readFileSync(path.join(__dirname, 'audit.js'), 'utf8');
const audit = {};
vm.runInNewContext(source.slice(source.indexOf('const CHECK ='), source.indexOf('async function auditGame')) + ';this.check = CHECK;', audit);

function instrument() {
  const WS = window.WebSocket;
  window.WebSocket = class extends WS {
    constructor(...args) {
      super(...args); window.__pcSocket = this;
      this.addEventListener('message', (event) => {
        const m = JSON.parse(event.data);
        if (m.data?.view?.pc) {
          window.__pc = m.data.view.pc;
          (window.__pcHistory ||= []).push(m.data.view.pc);
        }
      });
    }
  };
}
const view = (p) => p.evaluate(() => window.__pc);
async function tap(p, action) {
  const v = await view(p), label = v.actions.find((a) => a[0] === action)?.[1];
  assert.ok(label, `Action ${action} missing in ${JSON.stringify(v)}`);
  await p.getByRole('button', { name: label, exact: true }).click();
  try {
    await p.waitForFunction((revision) => window.__pc.revision > revision, v.revision);
    // Leave a human-sized gap between taps; the shared relay caps each socket
    // at 20 messages/second, including the host's per-role screen updates.
    await p.waitForTimeout(250);
  } catch (error) {
    console.error('Action did not update', action, 'before', v, 'after', await view(p));
    throw error;
  }
}
async function check(page, tv) {
  await page.waitForTimeout(350);
  const report = await page.evaluate(audit.check, tv);
  if (report.zoom !== 1 || ['outside', 'clipped', 'contrast', 'small'].some((k) => report[k].length)) {
    await page.screenshot({ path: `${OUT}/layout-issue.png` });
    console.log(await page.evaluate(() => [...document.querySelectorAll('.game,.stage,.pc-host,.pc-copy,.pc-lower')].map((e) => ({
      class: e.className, height: e.clientHeight, scroll: e.scrollHeight, width: e.clientWidth, scrollWidth: e.scrollWidth,
      rect: JSON.stringify(e.getBoundingClientRect())
    }))));
  }
  assert.equal(report.zoom, 1, JSON.stringify(report));
  for (const field of ['outside', 'clipped', 'contrast', 'small']) assert.deepEqual(report[field], [], `${field}: ${JSON.stringify(report)}`);
  if (tv) {
    await page.screenshot({ path: `${OUT}/latest-screen.png` });
    assert.ok(await page.evaluate(() => {
    const lower = document.querySelector('.pc-lower').getBoundingClientRect();
    return [...document.querySelectorAll('.pc-copy button')].every((b) => b.getBoundingClientRect().bottom <= lower.top);
    }), 'Controls must stay above the news banner');
  }
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
    await host.getByRole('button').filter({ hasText: 'Press Conference' }).click();
    const code = await host.locator('.roomcode').textContent();
    const phones = [];
    for (let i = 0; i < n; i++) {
      const p = await page(i === 1 ? 320 : 390, 844);
      await p.goto(BASE + '/?code=' + code);
      await p.locator('input[autocomplete=nickname]').fill(i === 1 ? 'VeryLongNameHere!' : `Reporter ${i + 1}`);
      await p.locator('button[type=submit]').click(); phones.push(p);
    }
    await host.waitForFunction((count) => document.querySelectorAll('.chip').length === count, n);
    await host.getByRole('button', { name: "Everybody's in!" }).click();
    await host.locator('.pc-setup').waitFor();
    await check(host, true);
    await host.screenshot({ path: `${OUT}/${n}-setup.png` });
    await host.getByRole('button', { name: 'Go live →', exact: true }).click();
    await host.locator('.pc-ready').waitFor();
    assert.equal(await host.evaluate(async () => (await import('/sdk/audio.js')).currentMusic()), null);
    for (let round = 1; round <= n; round++) {
      await phones[0].waitForFunction((r) => window.__pc?.phase === 'ready' && window.__pc.round === r, round);
      let views = await Promise.all(phones.map(view));
      const presenter = phones[views.findIndex((v) => v.presenting)];
      const secret = views.find((v) => !v.presenting).premise;
      assert.equal((await view(presenter)).premise, undefined);
      assert.equal((await host.locator('.pc-host').textContent()).includes(secret), false);
      if (round === 1) await check(host, true);
      await tap(presenter, 'ready');
      if (round === 1) {
        await check(host, true);
        await host.screenshot({ path: `${OUT}/${n}-live.png` });
        await check(presenter, false);
        await presenter.screenshot({ path: `${OUT}/${n}-presenter.png` });
        views = await Promise.all(phones.map(view));
        const active = phones[views.findIndex((v) => v.active)];
        await check(active, false);
        await active.screenshot({ path: `${OUT}/${n}-reporter.png` });
        // An out-of-turn reporter cannot advance the microphone.
        const other = phones[views.findIndex((v) => !v.active && !v.presenting)];
        const rev = (await view(other)).revision;
        await other.evaluate(() => window.__pcSocket.send(JSON.stringify({ t: 'send', data: {
          type: 'pc-action', match: window.__pc.match, revision: window.__pc.revision, action: 'next'
        } })));
        await host.waitForTimeout(100);
        assert.equal((await view(other)).revision, rev);
        // A duplicate stale action cannot skip a second reporter.
        const old = await view(active);
        await tap(active, 'next');
        await active.evaluate((v) => window.__pcSocket.send(JSON.stringify({ t: 'send', data: {
          type: 'pc-action', match: v.match, revision: v.revision, action: 'next'
        } })), old);
        await host.waitForTimeout(100);
        assert.equal((await view(active)).questions, 2);
        // A real disconnect pauses play; reconnect preserves the hidden role.
        await presenter.context().setOffline(true);
        await presenter.evaluate(() => window.__pcSocket.close());
        await host.waitForFunction(() => document.querySelector('.pc-copy').textContent.includes('disconnected'));
        await check(host, true);
        assert.equal((await host.locator('.pc-host').textContent()).includes(secret), false);
        await presenter.context().setOffline(false);
        await presenter.reload();
        await presenter.locator('.pc-mystery').waitFor();
        assert.equal((await view(presenter)).premise, undefined);
        assert.ok((await presenter.evaluate(() => window.__pcHistory)).every((v) => v.premise === undefined));
        await tap(presenter, 'guess');
        await check(host, true);
        views = await Promise.all(phones.map(view));
        await tap(phones[views.findIndex((v) => v.active)], 'miss');
        assert.equal((await view(presenter)).phase, 'live');
        assert.equal((await view(presenter)).premise, undefined);
      }
      await tap(presenter, 'guess');
      views = await Promise.all(phones.map(view));
      await tap(phones[views.findIndex((v) => v.active)], 'correct');
      await host.locator('.pc-reveal').waitFor();
      assert.ok((await host.locator('.pc-premise').textContent()).includes(secret));
      assert.equal((await view(presenter)).premise, secret);
      if (round === 1) {
        await check(host, true);
        await host.screenshot({ path: `${OUT}/${n}-reveal.png` });
        await check(phones[1], false);
      }
      views = await Promise.all(phones.map(view));
      await tap(phones[views.findIndex((v) => v.actions.some((a) => a[0] === 'continue'))], 'continue');
    }
    await host.locator('.pc-finished').waitFor();
    await check(host, true);
    await host.screenshot({ path: `${OUT}/${n}-finished.png` });
    assert.equal(await host.locator('.pc-result-row').count(), n);
    await host.getByRole('button', { name: 'Back to the lobby', exact: true }).click();
    await host.getByRole('button', { name: "Everybody's in!" }).waitFor();
    await host.waitForTimeout(300);
    assert.equal(await host.locator('link[href$="press-conference/host.css"]').count(), 0);
    assert.equal(await phones[0].locator('.pc-phone').count(), 0);
    assert.deepEqual(errors, []);
    console.log(`${n} players: full rotation, secrecy, turn permissions, guesses, reconnect, layout and cleanup passed.`);
  } finally { await Promise.all(contexts.map((c) => c.close())); }
}
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  try { await play(browser, 4); await play(browser, 12); }
  finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
