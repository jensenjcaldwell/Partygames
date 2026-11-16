// Integration check against a running Party Hall server. Requires Playwright.
// node tools/test-bot-brawl-browser.cjs [http://localhost:8080]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const BASE = process.argv[2] || 'http://localhost:8080';
const OUT = process.env.OUT || '/tmp/bot-brawl-qa';
fs.mkdirSync(OUT, { recursive: true });
const auditSource = fs.readFileSync(path.join(__dirname, 'audit.js'), 'utf8');
const audit = {};
vm.runInNewContext(auditSource.slice(auditSource.indexOf('const CHECK ='), auditSource.indexOf('async function auditGame')) + ';this.check = CHECK;', audit);

function instrument() {
  const WS = window.WebSocket;
  window.WebSocket = class extends WS {
    constructor(...args) {
      super(...args); window.__testSocket = this;
      this.addEventListener('message', (event) => {
        let message; try { message = JSON.parse(event.data); } catch { return; }
        if (message.data?.kind === 'view' && message.data.view?.botBrawl) {
          window.__bbView = message.data.view.botBrawl;
          (window.__bbPhases ||= []).push(window.__bbView.phase);
        }
      });
    }
  };
  // Only presentation waits are shortened. Real networking, planning deadlines,
  // reconnects, input validation and the rules engine are unchanged.
  const nativeTimeout = window.setTimeout.bind(window);
  window.setTimeout = (fn, ms, ...args) => nativeTimeout(fn, window.__bbFast && ms > 0 ? Math.max(10, ms * .5) : ms, ...args);
}

async function play(browser, mode, count, arenaName) {
  const contexts = [], errors = [], layout = [], observed = new Set();
  const newPage = async (viewport) => {
    const context = await browser.newContext({ viewport }); contexts.push(context);
    await context.addInitScript(instrument);
    const page = await context.newPage(); page.on('pageerror', (e) => errors.push(e.message));
    return page;
  };
  try {
    const host = await newPage({ width: 1920, height: 1080 });
    await host.goto(BASE + '/host');
    await host.getByRole('button').filter({ hasText: 'Bot Brawl' }).click();
    const code = await host.locator('.roomcode').textContent();
    const phones = [];
    for (let i = 0; i < count; i++) {
      const p = await newPage({ width: i === 1 ? 320 : 390, height: 844 });
      await p.goto(BASE + '/?code=' + code);
      await p.locator('input[autocomplete=nickname]').fill(['Jensen', 'VeryLongNameHere', 'Cy', 'Dee', 'Esmeralda', 'Fox', 'Gus', 'Hal'][i]);
      await p.locator('button[type=submit]').click(); phones.push(p);
    }
    await host.waitForFunction((n) => document.querySelectorAll('.chip').length === n, count);
    await host.getByRole('button', { name: "Everybody's in!" }).click();
    await phones[0].locator('.bb-arena-options').waitFor();
    assert.equal(await phones[0].locator('.bb-arena-option').count(), 6);
    // The captain's phone and TV use the same authoritative settings.
    await phones[0].getByRole('button', { name: new RegExp(arenaName) }).click();
    await host.locator('.bb-arena-option.selected').filter({ hasText: arenaName }).waitFor();
    assert.equal(await host.evaluate(async () => (await import('/sdk/audio.js')).currentMusic()), 'factory');
    const beforeMute = await host.evaluate(async () => (await import('/sdk/audio.js')).isMuted());
    await host.locator('button[title="Sound on/off"]').click();
    assert.equal(await host.evaluate(async () => (await import('/sdk/audio.js')).isMuted()), !beforeMute);
    await host.locator('button[title="Sound on/off"]').click();
    await host.getByRole('button', { name: mode === 'survival' ? 'ϟ Survival' : '⚑ Flag race', exact: true }).click();
    if (count === 2) for (let i = 0; i < 4; i++) await host.getByRole('button', { name: 'Add computer opponent' }).click();
    await host.screenshot({ path: `${OUT}/${mode}-setup.png` });
    const setupAudit = await host.evaluate(audit.check, true);
    assert.equal(setupAudit.zoom, 1, `Setup unexpectedly shrank: ${JSON.stringify(setupAudit)}`);
    // Other phones cannot change the settings by forging a captain action.
    await phones[1].evaluate(() => {
      const a = window.__bbView;
      window.__testSocket.send(JSON.stringify({ t: 'send', data: { type: 'settings', match: a.match, arena: 'furnace', start: true } }));
    });
    await host.waitForTimeout(100);
    assert.equal(await host.locator('.bb-setup').count(), 1);
    await phones[0].getByRole('button', { name: /Clock in/ }).click();
    await phones[0].locator('[data-card=forward]').waitFor();
    assert.ok(await host.locator('.bb-emitter').count() >= 3, 'Factory emitters must be visible outside the grid');
    assert.match(await host.locator('.bb-laser-status').textContent(), /LASERS ARMED.*AFTER BELTS/);
    assert.ok(await host.locator('.bb-laser-paths line').count() >= 3, 'Planning must preview potential laser paths');
    assert.ok(await host.locator('.bb-cell.pit .bb-pit-symbol').count() > 0, 'Pits need explicit instant-wreck markings');
    assert.match(await phones[0].locator('.bb-hazard-guide').textContent(), /instant wreck/);
    assert.equal(await host.locator('.bb-crate-mark').count(), 0, 'Round one must have no power-ups');
    await host.screenshot({ path: `${OUT}/${mode}-arena.png` });
    await phones[0].screenshot({ path: `${OUT}/${mode}-phone.png` });
    // The host rejects stale rounds and unknown cards without locking a player.
    await phones[0].evaluate(() => {
      const a = window.__bbView;
      for (const data of [{ round: a.round + 1, cards: Array(4).fill('forward') }, { round: a.round, cards: ['forward', 'left', 'laser', '__proto__'] }]) {
        window.__testSocket.send(JSON.stringify({ t: 'send', data: { type: 'program', match: a.match, power: false, ...data } }));
      }
    });
    await host.waitForTimeout(100);
    assert.equal(await phones[0].evaluate(() => window.__bbView.locked), false);
    // Edits and an unsubmitted draft survive a real phone reload.
    await phones[0].locator('[data-card=forward]').click();
    await phones[0].locator('[data-card=right]').click();
    await phones[0].reload();
    await phones[0].locator('.bb-slot.filled').first().waitFor();
    assert.equal(await phones[0].locator('.bb-slot.filled').count(), 2);
    await phones[0].locator('.bb-slot.filled').first().click();
    assert.equal(await phones[0].locator('.bb-slot.filled').count(), 1);
    for (let i = 0; i < 3; i++) await phones[0].locator('[data-card=forward]').click();
    await phones[0].getByRole('button', { name: 'Lock in program', exact: true }).click();
    await phones[0].getByRole('button', { name: 'Edit program' }).waitFor();
    assert.equal(await phones[1].evaluate(() => window.__bbView.program), null, 'Other players must not receive the secret program');
    await phones[0].reload();
    await phones[0].getByRole('button', { name: 'Edit program' }).waitFor();
    assert.equal(await phones[0].locator('.bb-slot.filled').count(), 4);
    await phones[0].getByRole('button', { name: 'Edit program' }).click();
    await phones[0].locator('[data-card=forward]').waitFor();
    await host.evaluate(() => { window.__bbFast = true; });
    const start = Date.now(); let lastRound = 0, replaySeen = false, cratesSeen = false;
    while (Date.now() - start < 160000) {
      if (await host.locator('.bb-results').count()) break;
      await Promise.all(phones.map((p) => p.evaluate(() => {
        const a = window.__bbView;
        if (!a || a.phase !== 'program' || a.locked || !a.bot?.alive) return;
        while (document.querySelectorAll('.bb-slot.filled').length < 4) {
          const card = document.querySelector('[data-card=forward]:not([disabled])'); if (!card) break; card.click();
        }
        const power = document.querySelector('.bb-power-toggle:not(.on):not([disabled])'); if (power) power.click();
        const lock = document.querySelector('.bb-lock:not([disabled])'); if (lock) lock.click();
      })));
      const view = await phones[0].evaluate(() => window.__bbView);
      observed.add(view.phase); replaySeen ||= view.phase === 'replay';
      if (view.round !== lastRound && view.phase === 'program') {
        lastRound = view.round;
        const check = await host.evaluate(audit.check, true); layout.push(check);
        assert.equal(check.zoom, 1, `Arena unexpectedly shrank in round ${lastRound}: ${JSON.stringify(check)}`);
        assert.deepEqual(check.outside, []);
        if (lastRound >= 2 && await host.locator('.bb-crate-mark').count()) cratesSeen = true;
        if (mode === 'survival' && lastRound === 2) assert.ok(await host.locator('.bb-cell.doom').count() > 0);
        console.log(`${mode}: round ${lastRound}, layout ${check.zoom}`);
      }
      await host.waitForTimeout(100);
    }
    await host.locator('.bb-results').waitFor({ timeout: 1000 });
    assert.ok(cratesSeen, 'Round two must introduce power-ups');
    assert.ok(replaySeen || (await phones[0].evaluate(() => window.__bbPhases)).includes('replay'), 'The match must show an incident replay');
    const phoneAudit = await phones[0].evaluate(audit.check, false);
    assert.deepEqual(phoneAudit.outside, []); assert.deepEqual(phoneAudit.contrast, []); assert.deepEqual(phoneAudit.small, []);
    await host.screenshot({ path: `${OUT}/${mode}-results.png` });
    await host.getByRole('button', { name: 'Back to the lobby', exact: true }).click();
    await host.getByRole('button', { name: "Everybody's in!" }).waitFor();
    assert.deepEqual(errors, [], `Browser errors: ${errors.join('; ')}`);
    for (const check of layout) {
      assert.deepEqual(check.contrast, []); assert.deepEqual(check.small, []);
      assert.deepEqual(check.clipped.filter((s) => !s.startsWith('.bb-board ')), []);
    }
    console.log(`${mode}: complete; ${count} humans, ${8 - count} computers; reconnects, secrecy, hazards and results passed`);
  } finally { await Promise.all(contexts.map((context) => context.close())); }
}

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  try {
    if (!process.env.MODE || process.env.MODE === 'race') await play(browser, 'race', 2, 'The Spillway');
    if (!process.env.MODE || process.env.MODE === 'survival') await play(browser, 'survival', 8, 'The Furnace');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
