const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const version = fs.readFileSync(path.join(root, 'version.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'custom-api.js'), 'utf8');
const connections = JSON.parse(fs.readFileSync(path.join(root, 'connections.json'), 'utf8'));
const news = JSON.parse(fs.readFileSync(path.join(root, 'news.json'), 'utf8'));
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const templates = [
      { id: 'hidden-1', revision: 3, updated_at: new Date().toISOString(), pwa_sync_enabled: true, document: { format: 'c-send-pwa-backup', version: 1, items: [{ id: 'hidden-1', name: '非表示の検証項目', value: '本文', tags: ['仕事'], mode: 'plain' }] } },
      { id: 'visible-1', revision: 2, updated_at: new Date().toISOString(), pwa_sync_enabled: true, document: { format: 'c-send-pwa-backup', version: 1, items: [{ id: 'visible-1', name: '表示中の検証項目', value: '本文', tags: ['仕事'], mode: 'plain' }] } },
      { id: 'disabled-1', revision: 1, updated_at: new Date().toISOString(), pwa_sync_enabled: false, document: { format: 'c-send-pwa-backup', version: 1, items: [{ id: 'disabled-1', name: '同期無効項目', value: '本文', tags: [], mode: 'plain' }] } }
    ];
    let writes = 0;
    await page.route('https://loose.bz/**', async route => {
      const url = new URL(route.request().url()), json = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
      if (url.pathname === '/c-send/pwa/' || url.pathname.endsWith('/index.html')) return route.fulfill({ contentType: 'text/html', body: html });
      if (url.pathname.endsWith('/version.js')) return route.fulfill({ contentType: 'application/javascript', body: version });
      if (url.pathname.endsWith('/custom-api.js')) return route.fulfill({ contentType: 'application/javascript', body: api });
      if (url.pathname.endsWith('/connections.json')) return json(connections);
      if (url.pathname.endsWith('/news.json')) return json(news);
      if (url.pathname.endsWith('/selection.json') || url.pathname.endsWith('/news')) return json({ format: 'c-send-pwa-backup', version: 1, items: [], releases: [] });
      if (url.pathname.endsWith('/auth/me')) return json({ id: 'hidden-sync-ci-user', username: 'test', role: 'user', pwa_auto_sync_enabled: true });
      if (url.pathname.endsWith('/templates') && route.request().method() === 'GET') return json({ templates, deleted: [] });
      if (url.pathname.endsWith('/templates')) { writes++; return json({}); }
      return route.fulfill({ status: 404, body: '' });
    });
    await page.goto('https://loose.bz/c-send/pwa/');
    await page.waitForFunction(() => document.querySelector('#appVersion').style.visibility === 'visible');
    await page.evaluate(async () => {
      const db = await new Promise(resolve => { const r = indexedDB.open('csend-web-local', 3); r.onsuccess = () => resolve(r.result); });
      await new Promise((resolve, reject) => { const tx = db.transaction('auth', 'readwrite'); tx.objectStore('auth').put({ id: 'https://loose.bz', userId: 'hidden-sync-ci-user', accessToken: 'test', accessExpiresAt: Date.now() + 3600000, refreshToken: 'test', pwaAutoSyncEnabled: true }); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
      localStorage.setItem('csend-web-hidden-site-templates', JSON.stringify(['hidden-1']));
    });
    await page.reload();
    await page.locator('#settingsButton').click();
    await page.locator('#menuAccount').click();
    await page.locator('#connectionsBody [data-account-entry="syncSettings"]').click();
    const section = page.locator('#hiddenSyncItemsSection');
    await section.waitFor();
    assert.equal(await section.isVisible(), true);
    await section.getByRole('button', { name: /非表示の同期項目を確認/ }).click();
    const card = page.locator('#hiddenSyncItemsList .hidden-sync-card');
    await card.waitFor();
    assert.match(await card.textContent(), /非表示の検証項目/);
    assert.equal(await card.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(231, 231, 231)');
    assert.equal(await card.locator('strong').evaluate(el => getComputedStyle(el).color), 'rgb(104, 104, 104)');
    assert.equal(await page.locator('#hiddenSyncItemsList .hidden-sync-card').count(), 1);
    await card.getByRole('button', { name: '表示に戻す' }).click();
    const confirm = page.locator('.backdrop.open').last();
    await confirm.getByRole('button', { name: '表示に戻す', exact: true }).click();
    await page.waitForFunction(() => !JSON.parse(localStorage.getItem('csend-web-hidden-site-templates') || '[]').includes('hidden-1'));
    assert.equal(writes, 0, 'Restoring a hidden item must not write to the server');
    assert.deepEqual(errors, []);
    await context.close();
    console.log('PASS: hidden sync cards, gray styling, muted titles, confirmed restore, no server writes');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
