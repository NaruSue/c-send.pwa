const { chromium } = require('playwright');
const fs = require('fs');
const assert = require('assert');
const html = fs.readFileSync('./index.html', 'utf8');
const version = fs.readFileSync('./version.js', 'utf8');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(10000);
  const errors = [];
  page.on('dialog', dialog => dialog.accept());
  const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
  page.on('pageerror', error => errors.push(error.message));
  let enabled = false, templates = [], deleted = [], serial = 1, templateReads = 0, failTemplateReads = false;
  const documentFor = item => ({ format: 'c-send-pwa-backup', version: 1, items: [item] });
  await page.route('https://loose.bz/**', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (url.pathname === '/c-send/pwa/' || url.pathname === '/c-send/pwa/index.html') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname === '/c-send/pwa/version.js') return route.fulfill({ contentType: 'application/javascript', body: version });
    if (url.pathname === '/c-send/pwa/custom-api.js') return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync('./custom-api.js', 'utf8') });
    if (url.pathname === '/c-send/pwa/connections.json' || url.pathname === '/c-send/pwa/news.json') return json(JSON.parse(fs.readFileSync('./' + url.pathname.split('/').pop(), 'utf8')));
    if (url.pathname.endsWith('/selection.json')) return json({ format: 'c-send-pwa-backup', version: 1, items: [] });
    if (url.pathname.endsWith('/news')) return json({ releases: [] });
    if (url.pathname.endsWith('/auth/me')) {
      if (method === 'PATCH') enabled = request.postDataJSON().pwa_auto_sync_enabled;
      return json({ id: 'test-user', username: 'test', role: 'user', pwa_auto_sync_enabled: enabled });
    }
    if (url.pathname.endsWith('/templates') && method === 'GET') {templateReads++;return failTemplateReads ? json({error:{message:'同期テストの接続失敗'}},503) : json({ templates, deleted });}
    if (url.pathname.endsWith('/templates') && method === 'POST') {
      const body = request.postDataJSON(), t = { id: '00000000-0000-0000-0000-' + String(serial++).padStart(12, '0'), revision: 1, updated_at: new Date().toISOString(), pwa_sync_enabled: true, document: body.document };
      templates.push(t);return json(t, 201);
    }
    const match = url.pathname.match(/\/templates\/([0-9a-f-]+)$/);
    if (match) {
      const t = templates.find(x => x.id === match[1]);
      if (method === 'DELETE') { templates = templates.filter(x => x.id !== match[1]);deleted.push({ id: match[1] });return json({ deleted: true }); }
      if (!t) return json({ error: { code: 'not_found', message: 'not found' } }, 404);
      if (method === 'GET') return json(t);
      if (method === 'PATCH') { t.pwa_sync_enabled = request.postDataJSON().pwa_sync_enabled;return json({ pwa_sync_enabled: t.pwa_sync_enabled }); }
      if (method === 'PUT') { const body = request.postDataJSON();if (body.base_revision !== t.revision) return json({ error: { code: 'revision_conflict', message: 'conflict' } }, 409);t.revision++;t.document = body.document;t.updated_at = new Date().toISOString();return json(t); }
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('https://loose.bz/c-send/pwa/');
  await page.waitForFunction(() => document.querySelector('#appVersion').style.visibility === 'visible');
  await page.evaluate(async () => { const db = await new Promise((resolve, reject) => { const r = indexedDB.open('csend-web-local', 3);r.onsuccess = () => resolve(r.result);r.onerror = () => reject(r.error); });await new Promise((resolve, reject) => { const tx=db.transaction('auth','readwrite');tx.objectStore('auth').put({id:'https://loose.bz',accessToken:'test',accessExpiresAt:Date.now()+3600000,refreshToken:'test',userId:'test-user'});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error); }); });
  await page.reload();
  await page.locator('#settingsButton').click();await page.locator('#menuAccount').click();await page.locator('#connectionsBody').getByRole('button',{name:'同期設定',exact:true}).click();
  const updateProfile=page.waitForResponse(response=>response.url().endsWith('/auth/me')&&response.request().method()==='PATCH');await page.locator('#autoSyncEnabled').check();await updateProfile;await page.waitForFunction(() => document.querySelector('#autoSyncEnabled').checked);
  assert.equal(enabled, true);
  await page.locator('[data-close="syncSettingsBackdrop"]').click();
  await page.locator('#closeConnections').click();
  await page.locator('#newButton').click();await page.locator('#name').fill('同期テスト');await page.locator('#value').fill('本文');await page.locator('#itemTags').fill('@秘密');
  await page.locator('#uploadToSite').waitFor({state:'visible'});await page.locator('#uploadToSite').check();assert.equal(await page.locator('#saveDestination').inputValue(),'official-portal');
  await page.locator('#uploadToSite').uncheck();assert.equal(await page.locator('#saveDestination').inputValue(),'local');
  await page.locator('#uploadToSite').check();await page.locator('#saveButton').click();
  await page.waitForFunction(() => document.querySelector('#list').textContent.includes('同期テスト'));
  await page.waitForFunction(() => document.querySelector('#status').textContent === '保存しました。');assert.equal(templates.length, 1);
  assert.equal(templates[0].document.items[0].value, '本文');assert.deepEqual(templates[0].document.items[0].tags,['@秘密']);
  const readsBeforeUnchanged=templateReads;await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await new Promise((resolve,reject)=>{const start=Date.now();const poll=()=>{if(templateReads>readsBeforeUnchanged)return resolve();if(Date.now()-start>10000)return reject(new Error('再同期リクエストなし'));setTimeout(poll,50)};poll()});
  failTemplateReads=true;await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.waitForFunction(()=>document.querySelector('#syncFooterMessage').textContent.includes('同期を保留'));
  failTemplateReads=false;await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.waitForFunction(()=>!document.querySelector('#syncFooterMessage').textContent.includes('同期を保留'));
  await page.evaluate(async () => {const db=await new Promise(resolve=>{const r=indexedDB.open('csend-web-local',3);r.onsuccess=()=>resolve(r.result)});await new Promise((resolve,reject)=>{const tx=db.transaction('items','readwrite');tx.objectStore('items').clear();tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})});
  await page.reload();await page.waitForFunction(() => document.querySelector('#appVersion').style.visibility === 'visible');await page.getByRole('button',{name:'鍵付きタグを認証して表示'}).click();await page.waitForFunction(() => document.querySelector('#list').textContent.includes('同期テスト'));assert.equal(await page.locator('[data-tag="@秘密"]').count(),1);
  await page.getByRole('button',{name:'同期テストを編集'}).click();await page.waitForFunction(() => document.querySelector('#uploadToSite').checked);assert.equal(await page.locator('#uploadToSite').isChecked(), true);
  assert.match(await page.locator('#siteSyncHint').textContent(), /バージョン 1/);
  templates[0].revision = 2;templates[0].document = documentFor({ name: 'サーバー版', value: '別端末の変更', mode: 'plain', tags: [] });
  await page.locator('#value').fill('この端末の変更');await page.locator('#saveButton').click();
  await page.getByRole('button',{name:'サーバー版を採用'}).click();
  await page.waitForFunction(() => document.querySelector('#list').textContent.includes('サーバー版'));
  assert.equal(templates[0].revision, 2);
  await page.getByRole('button',{name:'サーバー版を編集'}).click();
  await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable:true, get:()=>false }));
  await page.locator('#deleteButton').click();await page.getByRole('button',{name:'サーバーから削除',exact:true}).click();await page.getByRole('button',{name:'削除する',exact:true}).click();
  assert.equal(deleted.length, 0);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('csend-web-delete-queue-v2')).length), 1);
  assert.match(await page.locator('#syncFooterMessage').textContent(), /削除待ち 1件/);
  await page.evaluate(() => { delete navigator.onLine;window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('online')); });
  await page.waitForFunction(() => !document.querySelector('#list').textContent.includes('サーバー版'));
  assert.equal(deleted.length, 1);assert.deepEqual(errors, []);
  await page.locator('#newButton').click();await page.locator('#name').fill('端末へ切り替え');await page.locator('#value').fill('本文');await page.locator('#saveDestination').selectOption('official-portal');await page.locator('#saveButton').click();
  await page.waitForFunction(() => document.querySelector('#list').textContent.includes('端末へ切り替え'));
  await page.waitForFunction(() => document.querySelector('#status').textContent === '保存しました。');await page.getByRole('button', {name:'端末へ切り替えを編集'}).click();await page.waitForFunction(() => document.querySelector('#saveDestination').value === 'official-portal');await page.locator('#saveDestination').selectOption('local');await page.locator('#saveButton').click();
  await page.waitForFunction(() => !document.querySelector('#editorBackdrop').classList.contains('open'));
  const detached=await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('csend-web-local',3);r.onsuccess=()=>resolve(r.result)});return new Promise(resolve=>{const r=db.transaction('items').objectStore('items').getAll();r.onsuccess=()=>resolve(r.result.find(i=>i.name==='端末へ切り替え'))})});
  assert.equal(detached.siteId,undefined);assert.equal(detached.connectionId,undefined);assert.equal(detached.source,'local');assert.deepEqual(errors,[]);
  await browser.close();console.log('PWA auto-sync smoke test passed');
})().catch(error => { console.error(error);process.exit(1); });
