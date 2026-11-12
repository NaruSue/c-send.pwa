/* Real cross-origin HTTPS servers exercise browser CORS, PKCE and data isolation. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),https=require('node:https'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('https://127.0.0.1:'+server.address().port)));
const close=server=>new Promise(resolve=>server.close(resolve));
const documentFor=name=>({format:'c-send-pwa-backup',version:1,items:[{name,value:name+'本文',mode:'plain',tags:['テスト']}]});
(async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'csend-api-test-'));let browser;const servers=[];
 try{
  execFileSync('python',['-c',`from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from datetime import datetime,timedelta,timezone
from pathlib import Path
import sys
key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'localhost')])
now=datetime.now(timezone.utc)
cert=x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=1)).not_valid_after(now+timedelta(days=1)).sign(key,hashes.SHA256())
p=Path(sys.argv[1]);(p/'key.pem').write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()));(p/'cert.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM))`,tmp]);
  const tls={key:fs.readFileSync(path.join(tmp,'key.pem')),cert:fs.readFileSync(path.join(tmp,'cert.pem'))};
  const app=https.createServer(tls,(req,res)=>{const u=new URL(req.url,'https://localhost');if(u.pathname.endsWith('/selection.json')||u.pathname.endsWith('/news')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({format:'c-send-pwa-backup',version:1,items:[],releases:[]}));return}const file=path.join('.',u.pathname==='/c-send/pwa/'?'index.html':path.basename(u.pathname));if(!fs.existsSync(file)){res.writeHead(404);res.end();return}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.json')?'application/json':'text/html');let content=fs.readFileSync(file);if(file.endsWith('index.html')||file.endsWith('connections.json'))content=content.toString().replaceAll('https://loose.bz',appOrigin).replaceAll('https://narusue.github.io/c-send.pwa/',appUrl);res.end(content)});servers.push(app);
  const appOrigin=await listen(app),appUrl=appOrigin+'/c-send/pwa/';
  async function api(name){
   const data={name,cors:true,enabled:false,failWrite:false,templates:[{id:'same-template',revision:1,pwa_sync_enabled:true,updated_at:new Date().toISOString(),document:documentFor(name+'既存')}],deleted:[],calls:[],preflights:0,transactions:new Map(),rotations:0};
   const server=https.createServer(tls,async(req,res)=>{
    const url=new URL(req.url,data.origin);const json=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body))};
    if(data.cors&&req.headers.origin===appOrigin){res.setHeader('Access-Control-Allow-Origin',appOrigin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','GET, POST, PUT, PATCH, DELETE, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type')}
    if(req.method==='OPTIONS'){data.preflights++;res.writeHead(204);res.end();return}
    let body='';for await(const chunk of req)body+=chunk;body=body?JSON.parse(body):{};
    data.calls.push({path:url.pathname,method:req.method,authorization:req.headers.authorization,body});
    if(url.pathname==='/entry')return json({format:'c-send-api-server',version:1,name,apiBaseUrl:data.origin+'/api/',auth:{type:'c-send-pkce-v1',authorizationUrl:data.origin+'/authorize'},capabilities:{templateSync:true,news:false}});
    if(url.pathname==='/authorize'){
     assert.equal(url.searchParams.get('redirect_uri'),appUrl);assert.equal(url.searchParams.get('code_challenge_method'),'S256');
     data.transactions.set('test-code',{challenge:url.searchParams.get('code_challenge'),redirect:appUrl});
     res.writeHead(302,{Location:appUrl+'#code=test-code&state='+encodeURIComponent(url.searchParams.get('state'))});res.end();return;
    }
    if(url.pathname==='/api/auth/token'){
     if(body.grant_type==='authorization_code'){const transaction=data.transactions.get(body.code);assert.ok(transaction);assert.equal(crypto.createHash('sha256').update(body.code_verifier).digest('base64url'),transaction.challenge);assert.equal(body.redirect_uri,transaction.redirect);data.transactions.delete(body.code)}else{assert.equal(body.refresh_token,name[0]+'-refresh');data.rotations++}
     return json({access_token:name[0]+'-access',expires_in:900,refresh_token:name[0]+'-refresh',refresh_expires_in:2592000});
    }
    if(req.headers.authorization!=='Bearer '+name[0]+'-access')return json({error:{code:'unauthorized',message:'wrong token'}},401);
    if(url.pathname==='/api/auth/me'){if(req.method==='PATCH')data.enabled=body.pwa_auto_sync_enabled;return json({id:'same-user',username:name,pwa_auto_sync_enabled:data.enabled})}
    if(url.pathname==='/api/auth/revoke')return json({revoked:true});
    if(url.pathname==='/api/templates'){
     if(req.method==='GET')return json({templates:data.templates,deleted:data.deleted});
     const t={id:'new-'+name+'-'+data.templates.length,revision:1,pwa_sync_enabled:true,document:body.document,updated_at:new Date().toISOString()};data.templates.push(t);return json(t,201);
    }
    if(url.pathname.startsWith('/api/templates/')){
     if(data.failWrite&&['PATCH','PUT'].includes(req.method))return json({error:{code:'server_error',message:'一時障害'}},503);
     const id=decodeURIComponent(url.pathname.split('/').pop()),t=data.templates.find(t=>t.id===id);if(!t)return json({error:{code:'not_found',message:'missing'}},404);
     if(req.method==='DELETE'){data.templates=data.templates.filter(t=>t.id!==id);data.deleted.push({id});return json({deleted:true})}
     if(req.method==='PATCH'){t.pwa_sync_enabled=body.pwa_sync_enabled;return json({pwa_sync_enabled:t.pwa_sync_enabled})}
     if(req.method==='PUT'){if(t.revision!==body.base_revision)return json({error:{code:'revision_conflict',message:'conflict'}},409);t.document=body.document;t.revision++;return json(t)}
     return json(t);
    }
    return json({error:{code:'not_found',message:'missing'}},404);
   });servers.push(server);data.origin=await listen(server);return data;
  }
  const a=await api('Aサーバ'),b=await api('Bサーバ');
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const ready=async()=>{await page.waitForFunction(()=>document.querySelector('#appVersion').style.visibility==='visible')};
  const openConnections=async()=>{await page.locator('#settingsButton').click();await page.locator('#menuAccount').click();await page.locator('#customApiEntry').waitFor()};
  const row=name=>page.locator('#connectionsBody section').filter({has:page.getByRole('heading',{name,exact:true})});
  async function register(server){await openConnections();await page.locator('#customApiEntry').fill(server.origin+'/entry');await page.getByRole('button',{name:'接続先を確認',exact:true}).click();await page.getByRole('button',{name:'ログインして追加',exact:true}).click();await ready();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('csend-custom-connections-v1')||'[]').length>0)}
  async function allowSync(server){await openConnections();await row(server.name).locator('.connection-identity').waitFor();assert.equal(await row(server.name).locator('[data-connection-kind=custom]').count(),1);assert.match(await row(server.name).locator('.connection-identity').textContent(),/公式ではありません/);await row(server.name).getByRole('button',{name:'アカウント・同期設定'}).click();if(await page.locator('#customAccountBackdrop input').isChecked())await page.locator('#customAccountBackdrop').getByRole('button',{name:'今すぐ同期'}).click();else await page.locator('#customAccountBackdrop input').check();await page.getByRole('button',{name:'この接続先への送信を許可',exact:true}).click();await page.waitForFunction(name=>document.querySelector('#list').textContent.includes(name+'既存'),server.name);await page.locator('#customAccountBackdrop').getByRole('button',{name:'閉じる',exact:true}).click();await page.locator('#closeConnections').click()}
  await page.goto(appUrl);await ready();
  const validation=await page.evaluate(async()=>{
    const base={format:'c-send-api-server',version:1,name:'検証',apiBaseUrl:'https://example.com/api/',auth:{type:'c-send-pkce-v1',authorizationUrl:'https://example.com/login'}};
    const rejected=[];for(const data of [{...base,apiBaseUrl:'https://other.example/api/'},{...base,auth:{...base.auth,authorizationUrl:'https://other.example/login'}},{...base,apiBaseUrl:'https://user:pass@example.com/api/'}]){try{CsendCustomApi.definition(data,'https://example.com/entry','custom-test');rejected.push(false)}catch{rejected.push(true)}}
    sessionStorage.setItem('csend-custom-login',JSON.stringify({at:Date.now(),state:'expected',verifier:'verifier',redirectUri:location.origin+location.pathname}));history.replaceState(null,'',location.pathname+'#code=bad&state=wrong');let stateRejected=false;try{await CsendCustomApi.createClient({read:async()=>null,write:async()=>{throw new Error('must not write')}}).finish()}catch{stateRejected=true}const safeName=CsendCustomApi.definition({...base,name:'偽\u202e公式'},'https://example.com/entry','custom-test').name;return {safeName,rejected,stateRejected,clean:!location.hash&&!sessionStorage.getItem('csend-custom-login')};
  });assert.deepEqual(validation,{safeName:'偽公式',rejected:[true,true,true],stateRejected:true,clean:true});assert.equal(a.calls.length,0);
  // Missing CORS is detected by a real browser before any registration occurs.
  a.cors=false;await openConnections();await page.locator('#customApiEntry').fill(a.origin+'/entry');await page.getByRole('button',{name:'接続先を確認',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('CORS'));assert.equal(await page.getByRole('button',{name:'ログインして追加',exact:true}).count(),0);await page.locator('#closeConnections').click();a.cors=true;
  await register(a);assert.equal(a.enabled,false);assert.equal(await page.locator('#list .item').count(),0);
  await openConnections();await row(a.name).getByRole('button',{name:'アカウント・同期設定'}).click();await page.locator('#customAccountBackdrop input').check();await page.getByRole('button',{name:'この接続先への送信を許可',exact:true}).waitFor();assert.match(await page.locator('.backdrop.open').last().textContent(),/運営者が閲覧/);await page.screenshot({path:path.join(tmp,'custom-api-consent-mobile.png')});await page.locator('.backdrop.open').last().getByRole('button',{name:'キャンセル',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#customAccountBackdrop input').checked);assert.equal(a.enabled,false);assert.equal(a.calls.filter(c=>c.path==='/api/templates').length,0);await page.locator('#customAccountBackdrop').getByRole('button',{name:'閉じる',exact:true}).click();await page.locator('#closeConnections').click();await allowSync(a);
  b.enabled=true;await register(b);assert.equal(b.calls.filter(c=>c.path==='/api/templates').length,0);await allowSync(b);assert.match(await page.locator('#list').textContent(),/Aサーバ既存/);assert.match(await page.locator('#list').textContent(),/Bサーバ既存/);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('csend-custom-connections-v1'))),aid=saved.find(c=>c.name===a.name).id,bid=saved.find(c=>c.name===b.name).id;
  const readItems=()=>page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('csend-web-local',3);r.onsuccess=()=>resolve(r.result)});return new Promise(resolve=>{const r=db.transaction('items').objectStore('items').getAll();r.onsuccess=()=>resolve(r.result)})});
  let items=await readItems();assert.equal(items.filter(i=>i.siteId==='same-template').length,2);assert.equal(new Set(items.map(i=>i.id)).size,items.length);
  // The server's global opt-in does not substitute for local consent. Cancellation keeps the editor intact.
  await page.evaluate(id=>{const prefs=JSON.parse(localStorage.getItem('csend-connections-v1'));delete prefs[id].uploadConsent;localStorage.setItem('csend-connections-v1',JSON.stringify(prefs))},bid);const beforeBlocked=b.calls.filter(c=>c.path.startsWith('/api/templates')).length;
  await page.reload();await ready();assert.equal(b.calls.filter(c=>c.path.startsWith('/api/templates')).length,beforeBlocked);
  await page.getByRole('button',{name:'Bサーバ既存を編集'}).click();await page.waitForFunction(id=>document.querySelector('#editorBackdrop').classList.contains('open')&&document.querySelector('#saveDestination').value===id&&!document.querySelector('#uploadToSite').disabled,bid);await page.locator('#value').fill('キャンセルした本文');await page.locator('#saveButton').click();await page.getByRole('button',{name:'この接続先への送信を許可',exact:true}).waitFor();await page.locator('.backdrop.open').last().getByRole('button',{name:'キャンセル',exact:true}).click();assert.equal(await page.locator('#value').inputValue(),'キャンセルした本文');assert.equal(await page.locator('#editorBackdrop.open').count(),1);assert.equal(b.templates[0].document.items[0].value,'Bサーバ既存本文');await page.locator('[data-close=editorBackdrop]').click();await allowSync(b);
  await page.getByRole('button',{name:'Aサーバ既存を編集'}).click();await page.locator('#value').fill('Aだけ更新');const updating=page.waitForResponse(r=>r.url()===a.origin+'/api/templates/same-template'&&r.request().method()==='PUT');await page.locator('#saveButton').click();await updating;await page.waitForFunction(()=>document.querySelector('#status').textContent==='保存しました。');assert.equal(a.templates[0].document.items[0].value,'Aだけ更新',JSON.stringify(a.calls.filter(c=>c.method==='PUT')));assert.equal(b.templates[0].document.items[0].value,'Bサーバ既存本文');
  await context.setOffline(true);await page.getByRole('button',{name:'Bサーバ既存を編集'}).click();await page.locator('#value').fill('Bオフライン更新');await page.locator('#saveButton').click();await page.locator('#editorBackdrop.open').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#status').textContent==='端末に保存しました。同期を待っています。');assert.equal(b.templates[0].document.items[0].value,'Bサーバ既存本文');assert.ok((await readItems()).some(i=>i.connectionId===bid&&i.syncPending&&i.value==='Bオフライン更新'));
  const resend=page.waitForResponse(r=>r.url()===b.origin+'/api/templates/same-template'&&r.request().method()==='PUT');await context.setOffline(false);await page.evaluate(()=>window.dispatchEvent(new Event('online')));await resend;assert.equal(b.templates[0].document.items[0].value,'Bオフライン更新');
  b.failWrite=true;await page.getByRole('button',{name:'Bサーバ既存を編集'}).click();await page.locator('#value').fill('通信失敗でも保持');const failedWrite=page.waitForResponse(r=>r.url()===b.origin+'/api/templates/same-template'&&r.status()===503);await page.locator('#saveButton').click();await failedWrite;await page.waitForFunction(()=>document.querySelector('#status').textContent==='端末に保存しました。同期を待っています。');assert.ok((await readItems()).some(i=>i.connectionId===bid&&i.syncPending&&i.value==='通信失敗でも保持'));assert.equal(await page.locator('#editorBackdrop.open').count(),0);
  b.failWrite=false;const retry=page.waitForResponse(r=>r.url()===b.origin+'/api/templates/same-template'&&r.request().method()==='PUT');await page.evaluate(()=>window.dispatchEvent(new Event('online')));await retry;assert.equal(b.templates[0].document.items[0].value,'通信失敗でも保持');
  // Changing server creates a copy instead of PUTing another server's ID.
  await page.getByRole('button',{name:'Aサーバ既存を編集'}).click();await page.locator('#saveDestination').selectOption(bid);await page.locator('#name').fill('Bへのコピー');const copying=page.waitForResponse(r=>r.url()===b.origin+'/api/templates'&&r.request().method()==='POST');await page.locator('#saveButton').click();await copying;await page.waitForFunction(()=>document.querySelector('#list').textContent.includes('Bへのコピー'));await page.waitForFunction(()=>document.querySelector('#status').textContent==='保存しました。');assert.ok(b.templates.some(t=>t.document.items[0].name==='Bへのコピー'));assert.equal(a.templates.length,1);
  // Offline deletion is scoped to A, despite identical owner and template IDs.
  await context.setOffline(true);await page.getByRole('button',{name:'Aサーバ既存を編集'}).click();await page.locator('#deleteButton').click();await page.getByRole('button',{name:'サーバーから削除',exact:true}).click();await page.getByRole('button',{name:'削除する',exact:true}).click();
  assert.equal(a.deleted.length,0);const queue=await page.evaluate(()=>JSON.parse(localStorage.getItem('csend-web-delete-queue-v2')));assert.equal(queue[0].connectionId,aid);
  await context.setOffline(false);await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.waitForFunction(()=>!document.querySelector('#list').textContent.includes('Aサーバ既存'));assert.equal(a.deleted.length,1);assert.equal(b.deleted.length,0);assert.ok((await readItems()).some(i=>i.connectionId===bid&&i.siteId==='same-template'));
  // Refresh uses the right server, and disabled destinations make no API calls.
  for(let attempt=0;attempt<20&&!b.rotations;attempt++){
    await page.evaluate(async id=>{const db=await new Promise(resolve=>{const r=indexedDB.open('csend-web-local',3);r.onsuccess=()=>resolve(r.result)});await new Promise(resolve=>{const tx=db.transaction('auth','readwrite'),store=tx.objectStore('auth'),request=store.get('custom:'+id);request.onsuccess=()=>store.put({...request.result,accessExpiresAt:0});tx.oncomplete=resolve})},bid);
    await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.waitForTimeout(500);
  }assert.ok(b.rotations>0,'B server token was not refreshed');assert.ok(a.preflights>0&&b.preflights>0);
  await openConnections();await row(b.name).locator('input[type=checkbox]').uncheck();await page.waitForTimeout(300);const count=b.calls.length;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.waitForTimeout(300);assert.equal(b.calls.length,count);
  await row(b.name).locator('input[type=checkbox]').check();await page.locator('#closeConnections').click();
  await page.reload();await ready();assert.match(await page.locator('#list').textContent(),/Bサーバ既存/);
  await page.evaluate(id=>{const connections=JSON.parse(localStorage.getItem('csend-custom-connections-v1'));connections.find(c=>c.id===id).name='公式接続';localStorage.setItem('csend-custom-connections-v1',JSON.stringify(connections))},bid);b.name='公式接続';await page.reload();await ready();await openConnections();await row(b.name).locator('[data-connection-kind=custom]').waitFor();assert.match(await row(b.name).textContent(),/公式ではありません/);assert.equal(await page.locator('#connectionsBody [data-connection-kind=official]').count(),1);await page.locator('#closeConnections').click();
  await openConnections();await row(b.name).getByRole('button',{name:'登録を解除'}).click();await page.getByRole('button',{name:'削除する',exact:true}).click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('csend-custom-connections-v1')).length===1);items=await readItems();assert.ok(items.some(i=>i.name==='Bサーバ既存'&&!i.connectionId&&!i.siteId));assert.equal(b.deleted.length,0);
  await page.locator('#connectionsBackdrop .dialog-body').evaluate(el=>el.scrollTop=0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(tmp,'custom-api-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS: real HTTPS CORS/preflight, missing CORS, metadata/state rejection, PKCE login, local consent/cancellation, forged official name, opt-in, duplicate IDs, update isolation, offline edit/resend, cross-server copy, offline deletion, refresh, disable, persistence, unregister, mobile layout');
 }finally{if(browser)await browser.close();await Promise.all(servers.map(close));fs.rmSync(tmp,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1});
