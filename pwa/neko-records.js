const NekoRecords=(()=>{
 const URL='https://loose.bz/c-send/pwa/';
 const box=document.createElement('div');box.style.cssText='margin:12px 0;font-size:13px';
 document.getElementById('start').before(box);
 let generation=0;
 async function inspectSession(){try{const status=await NekoDiagnostics.session();if(!status){NekoDiagnostics.log('official_session_bridge_missing');return}const signedIn=status.connectionId==='official-portal'&&status.signedIn;document.querySelector('h1').textContent=signedIn?'猫パンチ耐久':'ねこパンチ耐久';NekoDiagnostics.log('official_session',{signedIn,hasUserId:status.hasUserId,official:status.connectionId==='official-portal'})}catch{NekoDiagnostics.log('official_session_error')}}
 inspectSession();window.addEventListener('focus',inspectSession);
 async function user(){return await NekoDiagnostics.user()||null}
 function reset(){generation++;box.replaceChildren()}
 function stamp(ms){return Math.floor(ms/60000)+'分'+(ms%60000/1000).toFixed(1)+'秒'}
 async function card(cat,ms,hits){
  const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=700;
  const c=canvas.getContext('2d');c.fillStyle='#efece5';c.fillRect(0,0,1000,700);
  c.textAlign='center';c.fillStyle='#394f40';c.font='bold 38px sans-serif';c.fillText('ねこパンチ耐久 / 自己ベスト',500,85);
  // Reuse the game's own cat illustration, with its computed coat colours.
  let svg=document.querySelector('svg.cat').cloneNode(true);if(cat.id==='twins'){const first=svg,second=document.querySelector('svg.second-cat').cloneNode(true),wrapper=document.createElementNS('http://www.w3.org/2000/svg','svg');wrapper.setAttribute('viewBox','0 0 600 300');first.setAttribute('width','300');second.setAttribute('width','300');second.setAttribute('x','300');wrapper.append(first,second);svg=wrapper}
  svg.querySelectorAll('.angry-face').forEach(el=>el.remove());
  const css=document.createElementNS('http://www.w3.org/2000/svg','style');css.textContent=`.fur{fill:var(--fur,${cat.fur})}.stripe{fill:none;stroke:var(--stripe,${cat.stripe});stroke-width:10;stroke-linecap:round}`;svg.prepend(css);svg.setAttribute('xmlns','http://www.w3.org/2000/svg');
  const image=new Image(),objectURL=window.URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}));
  try{image.src=objectURL;await image.decode();c.drawImage(image,cat.id==='twins'?200:350,100,cat.id==='twins'?600:300,300)}finally{window.URL.revokeObjectURL(objectURL)}
  c.fillStyle='#332e2a';c.font='bold 32px sans-serif';c.fillText(cat.name,500,435);
  c.font='bold 62px sans-serif';c.fillText(stamp(ms),500,520);
  c.font='28px sans-serif';c.fillText('受け止めたパンチ '+hits+'回',500,575);
  c.fillStyle='#766d62';c.font='22px sans-serif';c.fillText('c-send',500,645);
  return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('image')),'image/png'));
 }
 async function finish(cat,elapsed,hits){
  NekoDiagnostics.log('result_started',{cat:cat.id,elapsed:Math.round(elapsed),hits});inspectSession();
  reset();const token=generation;let id;
  try{id=await user();NekoDiagnostics.log('record_account',{identified:Boolean(id)})}catch{NekoDiagnostics.log('record_account_error');if(token===generation)box.textContent='ログイン情報を確認できませんでした。アカウント画面で接続をご確認ください';return}
  if(token!==generation)return;if(!id){box.replaceChildren();return}
  const key='csend-neko-best-v1:'+encodeURIComponent(String(id)),ms=Math.max(0,Math.round(elapsed));
  let records,previous;try{records=JSON.parse(localStorage.getItem(key)||'{}');if(!records||typeof records!=='object'||Array.isArray(records))records={};previous=records[cat.id];}catch{records={}}
  const isBest=!previous||!Number.isFinite(previous.ms)||ms>previous.ms;
  NekoDiagnostics.log('record_compared',{isBest,previousFound:Boolean(previous)});
  if(!isBest){box.textContent='この端末の自己ベスト '+stamp(previous.ms);return}
  try{records[cat.id]={ms,hits,at:new Date().toISOString()};localStorage.setItem(key,JSON.stringify(records))}catch{box.textContent='この端末に記録を保存できませんでした';return}
  NekoDiagnostics.log('record_saved');if(typeof NekoUnlocks!=='undefined')await NekoUnlocks.refresh();
  box.textContent='自己ベスト更新！';
  const button=document.createElement('button');button.className='secondary';button.style.margin='8px';button.textContent='共有画像を準備中…';button.disabled=true;box.append(document.createElement('br'),button);
  try{const blob=await card(cat,ms,hits);if(token!==generation||await user()!==id)return;
   const file=new File([blob],'c-send-neko-best.png',{type:'image/png'});button.textContent='画像でシェア';button.disabled=false;NekoDiagnostics.log('share_button_ready');
   const save=()=>{const a=document.createElement('a'),url=window.URL.createObjectURL(blob);a.href=url;a.download=file.name;a.click();setTimeout(()=>window.URL.revokeObjectURL(url),30000)};
   button.onclick=async()=>{if(await user()!==id){reset();return}if(navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:'ねこパンチ耐久の自己ベスト',text:cat.name+'の猫パンチに'+stamp(ms)+'耐えた！🐾\nc-sendのタイトルを5秒長押しすると遊べるよ。\n'+URL})}catch(e){if(e.name!=='AbortError'){button.textContent='画像を保存';button.onclick=async()=>{if(await user()!==id){reset();return}save()}}}}else save()};
  }catch{NekoDiagnostics.log('share_image_error');if(token!==generation)return;button.textContent='紹介リンクをコピー';button.disabled=false;button.onclick=async()=>{try{if(await user()!==id){reset();return}await navigator.clipboard.writeText('猫パンチに'+stamp(ms)+'耐えた！ c-sendのタイトルを5秒長押しすると遊べるよ。 '+URL);button.textContent='コピーしました'}catch{button.textContent='リンク：'+URL}}}
 }
 return {reset,finish};
})();
