const NekoUnlocks=(()=>{
 const normal=['mugi','kuro','koma','yuki'];let state={boss:false,twins:false,ending:false},owner=null,serial=0;
 const picker=document.createElement('select');picker.className='secondary';picker.hidden=true;picker.setAttribute('aria-label','猫を選ぶ');
 const song=document.createElement('button');song.className='secondary';song.textContent='おめでとうソング ♪';song.hidden=true;
 const note=document.createElement('p');note.style.cssText='font-size:13px;color:#655d52';note.hidden=true;
 document.querySelector('.below').after(picker,song,note);
 function evaluate(records){const enough=(ids,ms)=>ids.every(id=>Number.isFinite(records[id]?.ms)&&records[id].ms>=ms);const boss=enough(normal,300000),twins=boss&&enough([...normal,'boss'],600000);return {boss,twins,ending:twins&&enough(['twins'],600000)}}
 function available(){return [...normal,...(state.boss?['boss']:[]),...(state.twins?['twins']:[])]}
 async function refresh(){const request=++serial;let id=null,records={};try{id=await NekoDiagnostics.user();if(id)records=JSON.parse(localStorage.getItem('csend-neko-best-v1:'+encodeURIComponent(String(id)))||'{}')||{}}catch{}
  if(request!==serial)return state;
  const before=owner===id?state:{boss:false,twins:false,ending:false};owner=id;state=evaluate(records);
  picker.replaceChildren();for(const id of available()){const option=document.createElement('option');option.value=id;option.textContent=cats.find(c=>c.id===id).name;picker.append(option)}picker.value=cat?.id||'mugi';picker.hidden=!state.boss;song.hidden=!state.ending;
  const unlocked=['boss','twins','ending'].filter(k=>state[k]&&!before[k]);if(unlocked.length){note.textContent=unlocked.map(k=>({boss:'ボス猫があらわれた！',twins:'双子猫があらわれた！',ending:'全員から、おめでとう！'})[k]).join(' ');note.hidden=false}else if(!id)note.hidden=true;
  if(!state.ending)NekoAudio.stopCelebration?.();return state;
 }
 picker.onchange=()=>{if(mode==='playing'||mode==='countdown')return;cancelCountdown();choose(picker.value)};
 song.onclick=async()=>{NekoAudio.unlock();if(!state.ending)return;if(NekoAudio.celebrating()){NekoAudio.stopCelebration();song.textContent='おめでとうソング ♪';document.querySelector('.arena').classList.remove('celebrating');return}
  try{await NekoAudio.celebrate();song.textContent='お祝いを止める';document.querySelector('.arena').classList.add('celebrating');renderChoir()}catch{song.textContent='もう一度お祝いを再生'}
 };
 document.addEventListener('neko-celebration-ended',()=>{document.getElementById('nekoChoir')?.remove();document.querySelector('.arena').classList.remove('celebrating');song.textContent='おめでとうソング ♪'});
 function playing(value){picker.disabled=value;song.disabled=value;if(value){NekoAudio.stopCelebration();document.querySelector('.arena').classList.remove('celebrating');song.textContent='おめでとうソング ♪'}}
 return {evaluate,available,refresh,playing};
})();
