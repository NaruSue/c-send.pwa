const NekoDiagnostics=(()=>{
 let serial=0;const pending=new Map();
 window.addEventListener('message',event=>{if(event.source!==window.parent||event.origin!==location.origin||event.data?.type!=='neko-response')return;const entry=pending.get(event.data.requestId);if(!entry)return;clearTimeout(entry.timer);pending.delete(event.data.requestId);event.data.error?entry.reject(Error('account bridge')):entry.resolve(event.data.value)});
 function request(type){
   if(window.parent===window){const operation=type==='neko-session'?window.csendNekoOfficialSession:window.csendNekoUserId;return Promise.resolve().then(()=>operation?.()||null)}
   return new Promise((resolve,reject)=>{const requestId='neko-'+(++serial),timer=setTimeout(()=>{pending.delete(requestId);reject(Error('account timeout'))},12000);pending.set(requestId,{resolve,reject,timer});window.parent.postMessage({type,requestId},location.origin)});
 }
 function log(event,details={}){try{if(window.parent===window)window.csendNekoDiagnostic?.(event,details);else window.parent.postMessage({type:'neko-diagnostic',event,details},location.origin)}catch{}}
 log('game_loaded',{embedded:window.parent!==window});return {log,session:()=>request('neko-session'),user:()=>request('neko-user')};
})();
