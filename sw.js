'use strict';
/* Service worker — يجعل التطبيق يفتح فورًا ودون إنترنت (الهيكل فقط؛ البيانات تُحفظ في IndexedDB من التطبيق نفسه).
   عند رفع نسخة جديدة من الملفات غيّر رقم VERSION ليتجدد الكاش عند المستخدمين. */
const VERSION = 'v1';
const CACHE = 'ceo-dashboard-' + VERSION;
const SHELL = [
  './', 'index.html', 'style.css', 'config.js', 'data.js', 'charts.js', 'pages.js', 'clients.js', 'main.js',
  'vendor/echarts.min.js', 'vendor/crossfilter.min.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon.svg', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.indexOf('ceo-dashboard-') === 0 && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// شبكة أولًا (3 ثوانٍ كحد أقصى) لتصل التحديثات فور رفعها، ثم الكاش عند ضعف الاتصال أو انعدامه
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // طلبات Apps Script (البيانات) لا تمرّ من هنا

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const fromCache = () => cache.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? cache.match('index.html') : undefined));
    try {
      const res = await Promise.race([
        fetch(req),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))
      ]);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const cached = await fromCache();
      if (cached) return cached;
      return new Response('غير متصل', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
