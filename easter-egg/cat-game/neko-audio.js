const NekoAudio=(()=>{
 let ctx,selected='mugi',enabled=true,bgmSource=null,lastVoice=-1,voiceSource=null;
 const buffers=new Map(),loading=new Map(),active=new Set();
 const kinds=['bgm','hiss','success','failure','countdown','ending','voice-1','voice-2','voice-3'];
 function unlock(){try{ctx ||= new (window.AudioContext||window.webkitAudioContext)();if(ctx.state==='suspended')ctx.resume().catch(warning)}catch{warning()}}
 function warning(){document.getElementById('sound').textContent='音を再試行 ♪'}
 function load(id,kind){const original=id;if(id==='boss'&&!['bgm','hiss'].includes(kind))id='kuro';if(id==='twins'&&!['bgm','hiss'].includes(kind))id='mugi';const key=id+'-'+kind;if(buffers.has(key)){if(original!==id)buffers.set(original+'-'+kind,buffers.get(key));return Promise.resolve(buffers.get(key))}if(!loading.has(key))loading.set(key,fetch('neko-audio/'+key+'.mp3'+(kind==='hiss'?'?v=0.1.84':'')).then(r=>{if(!r.ok)throw Error('audio load');return r.arrayBuffer()}).then(b=>ctx.decodeAudioData(b)).then(b=>{buffers.set(key,b);if(original!==id)buffers.set(original+'-'+kind,b);return b}).catch(e=>{loading.delete(key);throw e}));return loading.get(key).then(b=>{buffers.set(original+'-'+kind,b);return b})}
 function ready(){unlock();if(!ctx)return Promise.reject(Error('audio unavailable'));return Promise.all(kinds.map(kind=>load(selected,kind)))}
 function play(kind,volume,loop=false){if(!enabled||!ctx||ctx.state!=='running')return null;const buffer=buffers.get(selected+'-'+kind);if(!buffer)return null;const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=buffer;if(selected==='twins'&&kind.startsWith('voice-'))source.playbackRate.value=1.10;source.loop=loop;gain.gain.value=volume;source.connect(gain);gain.connect(ctx.destination);active.add(source);source.onended=()=>{active.delete(source);source.disconnect();gain.disconnect()};source.start();return source}
 let celebration=null;
 function stopCelebration(){if(celebration){celebration.pause();celebration.currentTime=0}document.dispatchEvent(new Event('neko-celebration-ended'))}
 async function celebrate(){stop();unlock();celebration ||= new Audio('neko-audio/celebration.mp3');celebration.volume=enabled?.65:0;celebration.onended=()=>document.dispatchEvent(new Event('neko-celebration-ended'));await celebration.play()}
 function stop(){for(const s of active){try{s.stop()}catch{}}active.clear();bgmSource=voiceSource=null;if(celebration&&!celebration.paused)stopCelebration()}
 function bgm(){if(bgmSource){try{bgmSource.stop()}catch{}}bgmSource=play('bgm',.28,true)}
 let lastHiss=-Infinity;
 function hiss(){const now=performance.now();if(now-lastHiss<800)return;lastHiss=now;if(voiceSource){try{voiceSource.stop()}catch{}}voiceSource=play('hiss',.65)}
 function voice(){const choices=[0,1,2].filter(i=>i!==lastVoice);lastVoice=choices[Math.floor(Math.random()*choices.length)];if(voiceSource){try{voiceSource.stop()}catch{}}voiceSource=play('voice-'+(lastVoice+1),.7)}
 document.getElementById('sound').onclick=async()=>{enabled=!enabled;const button=document.getElementById('sound');button.setAttribute('aria-pressed',String(enabled));button.textContent=enabled?'音 ON ♪':'音 OFF ♪';if(celebration)celebration.volume=enabled?.65:0;if(!enabled){for(const source of active){try{source.stop()}catch{}}active.clear();bgmSource=voiceSource=null;return}unlock();try{await ready();if(mode==='playing')bgm()}catch{warning()}};
 window.addEventListener('pagehide',stop);document.addEventListener('visibilitychange',()=>{if(document.hidden)stop()});
 return {hiss,celebrate,stopCelebration,celebrating:()=>Boolean(celebration&&!celebration.paused),unlock,ready,warning,stop,bgm,voice,effect:kind=>play(kind,.55),select:id=>{stop();for(const name of ['boss-bgm','twins-bgm']){buffers.delete(name);loading.delete(name)}selected=id;lastVoice=-1;lastHiss=-Infinity}};
})();
