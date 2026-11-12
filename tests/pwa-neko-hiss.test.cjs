const fs=require('fs'),assert=require('assert');const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch({headless:true});try{const p=await b.newPage();await p.route('https://loose.bz/c-send/pwa/**',r=>{const f=new URL(r.request().url()).pathname.slice('/c-send/pwa/'.length);r.fulfill({contentType:f.endsWith('.html')?'text/html':f.endsWith('.js')?'application/javascript':'audio/mpeg',body:fs.readFileSync('./'+f)})});await p.goto('https://loose.bz/c-send/pwa/easter-egg/cat-game/neko-punch.html');

await p.locator('#sound').click();await p.locator('#sound').click();await p.evaluate(async()=>{await NekoAudio.ready();mode='playing';next=Infinity;$('overlay').classList.add('hidden');window.starts=0;const original=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...args){starts++;return original.apply(this,args)}});
const point=async(x,y)=>p.locator('svg.cat').evaluate((svg,point)=>{const p=new DOMPoint(...point).matrixTransform(svg.getScreenCTM());return {x:p.x,y:p.y}},[x,y]);
const face=await point(150,125);await p.mouse.click(face.x,face.y);assert.equal(await p.locator('#missLabel').textContent(),'ミス 1 / 10');assert.equal(await p.locator('svg.hissing').count(),1);assert.equal(await p.evaluate(()=>starts),1);
await p.mouse.click(face.x,face.y);assert.equal(await p.locator('#missLabel').textContent(),'ミス 2 / 10');assert.equal(await p.evaluate(()=>starts),1);
const body=await point(150,235);await p.mouse.click(body.x,body.y);assert.equal(await p.locator('#missLabel').textContent(),'ミス 3 / 10');assert.equal(await p.evaluate(()=>starts),2);
await p.evaluate(()=>punch('left'));await p.locator('.target').dispatchEvent('pointerdown');assert.equal(await p.locator('#missLabel').textContent(),'ミス 3 / 10');assert.equal(await p.locator('#hits').textContent(),'1');
await p.evaluate(()=>{NekoAudio.select('boss')});await p.evaluate(()=>NekoAudio.ready());await p.evaluate(()=>{NekoAudio.select('twins')});await p.evaluate(()=>NekoAudio.ready());
console.log('PASS: face hit is one miss plus hiss, cooldown suppresses overlap, body uses normal miss, targets do not hiss, boss/twin audio decodes');
}finally{await b.close()}})().catch(e=>{console.error(e);process.exit(1)});
