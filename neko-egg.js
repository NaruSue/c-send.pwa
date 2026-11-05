// Kept separate from template storage and account operations.
(() => {
  const title = document.getElementById('nekoTitle');
  if (!title) return;
  const HOLD_MS = 5000;
  const trigger = title.closest('.brand');
  trigger.style.cssText += ';touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;min-height:44px;display:flex;align-items:center;position:relative';
  const progress = document.createElement('span');
  progress.setAttribute('aria-hidden','true');
  progress.style.cssText='position:absolute;bottom:0;left:0;height:2px;background:currentColor;opacity:0;width:0;pointer-events:none';
  trigger.append(progress);
  let progressTimer=null, started=0, originX=0, originY=0;
  let timer = null, pointer = null, key = null, suppressClick = false, dialog = null;
  function cancel() {
    clearTimeout(timer);
    clearInterval(progressTimer);
    progress.style.opacity='0';
    progress.style.width='0';
    timer = null;
    pointer = null;
    key = null;
  }
  function closeGame() {
    if (!dialog) return;
    dialog._controller.abort();
    dialog.querySelector('iframe').src = 'about:blank';
    for(const [element,wasInert] of dialog._previousInert)element.inert=wasInert;
    dialog.remove();
    dialog = null;
    title.focus({preventScroll:true});
  }
  function openGame() {
    cancel();
    if (dialog) return;
    dialog = document.createElement('div');
    dialog.id='nekoGameLayer';
    dialog.setAttribute('role','dialog');
    dialog.setAttribute('aria-modal','true');
    dialog.setAttribute('aria-label', 'ねこパンチ耐久');
    dialog.style.cssText = 'position:fixed;inset:0;z-index:2147483647;margin:0;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom);width:100%;height:100%;background:#efece5;overflow:hidden;display:block;';
    const layout = document.createElement('div');
    layout.style.cssText = 'height:100%;width:min(680px,100%);margin:auto;display:grid;grid-template-rows:56px minmax(0,1fr)';
    const close = document.createElement('button');
    close.textContent = 'ゲームを閉じる ×';
    close.style.cssText = 'flex:none;justify-self:end;align-self:center;margin:8px 14px;padding:8px 14px;border:1px solid #c6bdb0;border-radius:24px;background:#efece5;color:#332e2a';
    close.onclick = closeGame;
    const frame = document.createElement('iframe');
    frame.title = 'ねこパンチ耐久ゲーム';
    frame.allow='web-share';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.src = 'neko-punch.html?v=0.1.84';
    window.csendNekoDiagnostic?.('parent_open');
    frame.addEventListener('load',()=>window.csendNekoDiagnostic?.('frame_loaded'));
    frame.style.cssText = 'display:block;width:100%;height:100%;min-height:0;border:0;background:#efece5';
    layout.append(close, frame);
    dialog.append(layout);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeGame(); });
    window.addEventListener('message', event => {
      if(!dialog||event.source!==frame.contentWindow||event.origin!==location.origin)return;
      if(event.data==='neko-close'){closeGame();return}
      const data=event.data;if(!data||typeof data!=='object')return;
      if(data.type==='neko-diagnostic'){window.csendNekoDiagnostic?.(data.event,data.details);return}
      if(!['neko-session','neko-user'].includes(data.type)||typeof data.requestId!=='string')return;
      const operation=data.type==='neko-session'?window.csendNekoOfficialSession:window.csendNekoUserId;
      Promise.resolve().then(()=>{if(typeof operation!=='function')throw Error('bridge missing');return operation()}).then(value=>{
        frame.contentWindow?.postMessage({type:'neko-response',requestId:data.requestId,value},location.origin);
      }).catch(()=>{window.csendNekoDiagnostic?.('account_bridge_error');frame.contentWindow?.postMessage({type:'neko-response',requestId:data.requestId,error:true},location.origin)});
    }, {signal: (dialog._controller = new AbortController()).signal});
    const controller = dialog._controller;
    close.addEventListener('click', () => controller.abort());
    dialog.addEventListener('cancel', () => controller.abort());
    dialog._previousInert=[...document.body.children].map(element=>[element,element.inert]);
    for(const [element] of dialog._previousInert)element.inert=true;
    document.body.append(dialog);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeGame()}},{signal:controller.signal});
    close.focus();
  }
  function begin() {
    clearTimeout(timer);
    suppressClick = false;
    started=performance.now();
    clearInterval(progressTimer);
    progressTimer=setInterval(()=>{progress.style.opacity='.5';progress.style.width=Math.min(100,(performance.now()-started)/HOLD_MS*100)+'%'},100);
    timer = setTimeout(() => {
      suppressClick = true;
      openGame();
    }, HOLD_MS);
  }
  trigger.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || dialog) return;
    cancel();pointer = event.pointerId;
    originX=event.clientX;originY=event.clientY;begin();
  });
  trigger.addEventListener('pointermove', event => {
    if(event.pointerId===pointer && Math.hypot(event.clientX-originX,event.clientY-originY)>32)cancel();
  });
  for(const name of ['pointerup','pointercancel'])window.addEventListener(name,event=>{
    if(event.pointerId===pointer)cancel();
  });
  trigger.addEventListener('contextmenu', event => event.preventDefault());
  trigger.addEventListener('click', event => {
    if (suppressClick) { event.preventDefault(); event.stopPropagation(); suppressClick = false; }
  });
  title.addEventListener('keydown', event => {
    if (![' ', 'Enter'].includes(event.key) || dialog) return;
    event.preventDefault();
    if (event.repeat) return;
    cancel();
    key = event.key;
    begin();
  });
  title.addEventListener('keyup', event => { if (event.key === key) cancel(); });
  title.addEventListener('blur', () => { if(key!==null)cancel(); });
  window.addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
})();

