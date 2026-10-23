/* Installed only by the static Pages build; Flask/local UI remains unchanged. */
(function(){
  const script=document.currentScript,base=new URL('../../',script.src),nativeFetch=window.fetch.bind(window);
  const workerUrl=new URL('static/js/pages-worker.js',base);workerUrl.search=new URL(script.src).search;
  const worker=new Worker(workerUrl,{type:'module'});
  const pending=new Map();let nextId=0;
  const setStatus=text=>{const el=document.querySelector('#appSplash .splash-label');if(el)el.textContent=text;};
  worker.onmessage=({data})=>{
    if(data.type==='status'){setStatus(data.text);return;}
    const item=pending.get(data.id);if(!item)return;pending.delete(data.id);
    if(data.error)item.reject(Error(data.error));else item.resolve(data.result);
  };
  worker.onerror=event=>{const error=Error(event.message || 'Browser trading engine failed to start.');for(const item of pending.values())item.reject(error);pending.clear();setStatus(error.message);};
  async function request(path,options={}){
    if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
    const id=++nextId;
    const result=await new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({id,path,method:options.method||'GET',body:options.body||null,contentType:new Headers(options.headers).get('Content-Type')||'application/json'});});
    if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
    if(path==='/browser/backup' && result.text){
      const backup=JSON.parse(result.text);backup.preferences={};
      for(const key of Object.keys(localStorage))if(key.startsWith('tfb_'))backup.preferences[key]=localStorage.getItem(key);
      result.text=JSON.stringify(backup);
    }
    const body=result.text ?? Uint8Array.from(atob(result.body),c=>c.charCodeAt(0));
    return new Response(body,{status:result.status,headers:result.headers});
  }
  window.fetch=(input,options={})=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(url.origin===location.origin && url.pathname.startsWith('/api/'))return request(url.pathname+url.search,options);
    return nativeFetch(input,options);
  };
  async function download(path,name){const r=await request(path);if(!r.ok)throw Error(await r.text());const url=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  document.addEventListener('click',event=>{
    const link=event.target.closest?.('a[href^="/api/export/"]');if(!link)return;
    event.preventDefault();download(link.getAttribute('href'),link.getAttribute('href').split('/').at(-1)).catch(error=>alert(error.message));
  });
  document.addEventListener('DOMContentLoaded',()=>{
    const host=document.querySelector('#sidebar');if(!host)return;
    const box=document.createElement('div');box.style.cssText='padding:12px;font-size:11px;color:#929baa';
    box.innerHTML='<div>Browser edition · saved on this device</div><button type="button" id="pagesBackup">Download backup</button> <button type="button" id="pagesRestore">Restore backup</button><input id="pagesBackupFile" type="file" accept="application/json,.json" hidden><div id="pagesStorageStatus" role="status"></div>';
    host.append(box);
    box.querySelector('#pagesBackup').onclick=()=>download('/browser/backup','intensefxtrades-backup.json').catch(error=>box.querySelector('[role=status]').textContent=error.message);
    box.querySelector('#pagesRestore').onclick=()=>box.querySelector('input').click();
    box.querySelector('input').onchange=async event=>{const file=event.target.files[0];if(!file)return;if(!confirm('Replace this device’s current workspace with the selected backup?'))return;try{const text=await file.text(),backup=JSON.parse(text);await request('/browser/restore',{method:'POST',body:text});for(const key of Object.keys(localStorage))if(key.startsWith('tfb_'))localStorage.removeItem(key);for(const [key,value] of Object.entries(backup.preferences||{}))if(key.startsWith('tfb_')&&typeof value==='string')localStorage.setItem(key,value);location.reload();}catch(error){box.querySelector('[role=status]').textContent=error.message;}};
  });
  window.TradeFXBookPages={request,worker};
})();
