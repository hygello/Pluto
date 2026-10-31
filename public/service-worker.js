/* Pluto PWA shell caching; never cache authenticated API responses. */
const CACHE_NAME='pluto-shell-v1';
const SHELL_URLS=['/manifest.webmanifest','/icons/pluto-192.svg','/icons/pluto-512.svg'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL_URLS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('pluto-shell-')&&k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin)return;
 if(req.mode==='navigate'){
  event.respondWith(fetch(req).then(res=>{if(res.ok){const copy=res.clone();caches.open(CACHE_NAME).then(cache=>cache.put('/',copy));}return res;}).catch(async()=> (await caches.match('/'))||new Response('<!doctype html><meta name="viewport" content="width=device-width"><title>Pluto offline</title><main style="font:16px system-ui;padding:2rem"><h1>You are offline</h1><p>Reconnect to use Pluto. Your account and mining data need an internet connection.</p></main>',{headers:{'Content-Type':'text/html; charset=utf-8'}})));
  return;
 }
 if(SHELL_URLS.includes(url.pathname)){event.respondWith(caches.match(req).then(hit=>hit||fetch(req)));return;}
});
