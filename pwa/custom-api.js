/* c-send custom API v1: browser transport and PKCE, no server-supplied code. */
(()=>{
  'use strict';
  const fail=message=>{throw new Error(message)};
  function https(value,base){
    if(typeof value!=='string'||!value.trim())fail('HTTPS URLを指定してください。');
    const url=new URL(value,base);
    if(url.protocol!=='https:'||url.username||url.password||url.hash)fail('認証情報やフラグメントを含まないHTTPS URLを指定してください。');
    return url;
  }
  function definition(data,entryUrl,id){
    const entry=https(entryUrl);
    if(data?.format!=='c-send-api-server'||data.version!==1||typeof data.name!=='string'||!data.name.trim()||data.name.length>100)fail('カスタムAPIサーバ仕様v1に対応していません。');
    const api=https(data.apiBaseUrl,entry);
    if(api.origin!==entry.origin||api.search||!api.pathname.endsWith('/'))fail('API入口とAPI基準URLは同じオリジンで、API基準URLの末尾は / にしてください。');
    if(data.auth?.type!=='c-send-pkce-v1')fail('未対応の認証方式です。');
    const authorize=https(data.auth.authorizationUrl,entry);
    if(!data.auth.authorizationUrl||authorize.origin!==entry.origin)fail('ログイン開始URLはAPI入口と同じオリジンにしてください。');
    const name=data.name.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'').trim();
    if(!name)fail('サーバ名を確認してください。');
    const c={id,custom:true,entryUrl:entry.href,name,baseUrl:entry.origin+'/',apiBaseUrl:api.href,color:/^#[0-9a-f]{6}$/i.test(data.color||'')?data.color:'#39847c',auth:{type:'c-send-pkce-v1',authorizationUrl:authorize.href},capabilities:{account:true,templateSync:data.capabilities?.templateSync===true,news:data.capabilities?.news===true,backup:false},menu:[]};
    if(c.capabilities.news){const news=https(data.news?.url,entry);if(!data.news?.url||news.origin!==entry.origin)fail('お知らせURLはAPI入口と同じオリジンにしてください。');c.news={url:news.href}}
    return c;
  }
  async function jsonFetch(url,options={}){
    const response=await fetch(url,{...options,credentials:'omit',cache:'no-store',redirect:'error',signal:options.signal||AbortSignal.timeout(15000)});
    const data=await response.json().catch(()=>fail('APIがJSONを返しませんでした。'));
    if(!response.ok){const error=new Error(data?.error?.message||'APIとの通信に失敗しました（'+response.status+'）');error.code=data?.error?.code||'api_error';error.status=response.status;throw error}
    return data;
  }
  async function discover(entryUrl,id){
    const entry=https(entryUrl);
    try{return definition(await jsonFetch(entry.href),entry.href,id)}catch(error){if(error instanceof TypeError)throw new Error('接続できません。URL・HTTPS・サーバのCORS設定を確認してください。');throw error}
  }
  const base64url=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
  function createClient({read,write}){
    const rotations=new Map();
    function tokens(data,old={}){
      if(typeof data.access_token!=='string'||!data.access_token||typeof data.refresh_token!=='string'||!data.refresh_token||!Number.isFinite(data.expires_in)||data.expires_in<=0||!Number.isFinite(data.refresh_expires_in)||data.refresh_expires_in<=0)fail('認証トークンの応答形式が不正です。');
      return {...old,accessToken:data.access_token,accessExpiresAt:Date.now()+data.expires_in*1000,refreshToken:data.refresh_token,refreshExpiresAt:Date.now()+data.refresh_expires_in*1000};
    }
    function endpoint(c,path){if(!/^\/[a-z]/i.test(path)||path.includes('..')||path.includes('\\'))fail('APIパスが不正です。');return c.apiBaseUrl.replace(/\/$/,'')+path}
    async function exchange(c,body){return jsonFetch(endpoint(c,'/auth/token'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}
    async function rotate(c,auth,force=false){
      if(rotations.has(c.id))return rotations.get(c.id);
      const work=async()=>{
        let current=await read(c.id);
        if(!current?.refreshToken)fail('ログインしてください。');
        if(current.accessExpiresAt>Date.now()+60000&&(!force||current.accessToken!==auth.accessToken))return current;
        try{const updated=tokens(await exchange(c,{grant_type:'refresh_token',refresh_token:current.refreshToken}),current);if((await read(c.id))?.refreshToken!==current.refreshToken)fail('ログイン状態が変更されました。');await write(c.id,updated);return updated}
        catch(error){if(error.code==='refresh_token_superseded'){for(let i=0;i<20;i++){await new Promise(resolve=>setTimeout(resolve,100));const latest=await read(c.id);if(latest?.refreshToken&&latest.refreshToken!==current.refreshToken)return latest}}throw error}
      };
      const promise=(navigator.locks?.request?navigator.locks.request('csend-custom-refresh:'+c.id,work):work()).finally(()=>rotations.delete(c.id));rotations.set(c.id,promise);return promise;
    }
    async function request(c,path,options={}){
      let auth=await read(c.id);if(!auth)fail('ログインしてください。');if(auth.accessExpiresAt<Date.now()+60000)auth=await rotate(c,auth);
      const headers=new Headers(options.headers||{});headers.set('Authorization','Bearer '+auth.accessToken);
      let body=options.body;if(body&&typeof body!=='string'){headers.set('Content-Type','application/json');body=JSON.stringify(body)}
      const send=()=>jsonFetch(endpoint(c,path),{...options,headers,body});
      try{return await send()}catch(error){if(error.status!==401)throw error;auth=await rotate(c,auth,true);headers.set('Authorization','Bearer '+auth.accessToken);return send()}
    }
    async function start(c,redirectUri,pending=false){
      const verifier=base64url(crypto.getRandomValues(new Uint8Array(32))),state=base64url(crypto.getRandomValues(new Uint8Array(32))),challenge=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
      sessionStorage.removeItem('csend_pwa_pkce_verifier');sessionStorage.removeItem('csend_pwa_oauth_state');
      sessionStorage.setItem('csend-custom-login',JSON.stringify({connection:c,verifier,state,redirectUri,pending,at:Date.now()}));
      const url=new URL(c.auth.authorizationUrl);url.searchParams.set('state',state);url.searchParams.set('code_challenge',challenge);url.searchParams.set('code_challenge_method','S256');url.searchParams.set('redirect_uri',redirectUri);location.assign(url.href);
    }
    async function finish(){
      const raw=sessionStorage.getItem('csend-custom-login');if(!raw)return null;
      const fragment=new URLSearchParams(location.hash.slice(1));if(!fragment.has('code')&&!fragment.has('state')&&!fragment.has('error'))return null;
      sessionStorage.removeItem('csend-custom-login');history.replaceState(null,'',location.pathname+location.search);
      const saved=JSON.parse(raw);
      if(!Number.isFinite(saved.at)||Date.now()-saved.at>10*60*1000||fragment.get('state')!==saved.state||!saved.verifier||saved.redirectUri!==location.origin+location.pathname)fail('ログイン状態を確認できません。もう一度ログインしてください。');
      if(fragment.has('error')||!fragment.get('code'))fail('ログインが完了しませんでした。');
      const c=definition({format:'c-send-api-server',version:1,...saved.connection},saved.connection.entryUrl,saved.connection.id);
      const auth=tokens(await exchange(c,{grant_type:'authorization_code',code:fragment.get('code'),code_verifier:saved.verifier,redirect_uri:saved.redirectUri}));
      // Validate the account before committing a new connection.
      const profile=await jsonFetch(endpoint(c,'/auth/me'),{headers:{Authorization:'Bearer '+auth.accessToken}});
      if(typeof profile.id!=='string'||!profile.id)fail('ユーザー情報の応答形式が不正です。');
      await write(c.id,{...auth,userId:profile.id,email:profile.email||profile.username||'',pwaAutoSyncEnabled:profile.pwa_auto_sync_enabled===true});return c;
    }
    return {request,start,finish};
  }
  globalThis.CsendCustomApi={definition,discover,createClient};
})();
