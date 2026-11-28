const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    try { ready = (await fetch('http://127.0.0.1:19232/json/version')).ok; } catch {}
    if (!ready) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(ready, 'WebView2 debugging endpoint did not start');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:19232');
  try {
    let page;
    for (let i = 0; i < 60 && !page; i++) {
      page = browser.contexts().flatMap(context => context.pages()).find(p => p.url().startsWith('https://narusue.github.io/c-send.pwa/'));
      if (!page) await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.ok(page, 'Official PWA must load in the actual wrapper');
    await page.waitForFunction(() => window.CsendDesktop?.available && document.querySelector('#appVersion')?.style.visibility === 'visible', null, { timeout: 60000 });
    assert.equal(await page.locator('#installTrigger').isVisible(), false, 'Install button must be hidden inside the wrapper');
    const result = await page.evaluate(async () => {
      const before = await window.CsendDesktop.getInfo();
      const sent = await window.CsendDesktop.publishQuickList({items:[{id:'ci-real-bridge',title:'実機連携の確認',value:'test text',mode:'plain',tags:[],source:'local'}]});
      const after = await window.CsendDesktop.getInfo();
      return { before, sent, after };
    });
    assert.equal(result.before.wrapperVersion, '0.0.5');
    assert.equal(result.sent, true);
    assert.equal(result.after.quickListCount, 1, 'The native wrapper must receive the real PWA list');
    console.log('PASS: real remote PWA can call the wrapper and publish a list');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
