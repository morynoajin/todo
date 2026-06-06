const CACHE = 'todo-pwa-v2';
const SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
];

/* ===== INSTALL: cache app shell ===== */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

/* ===== ACTIVATE: remove old caches ===== */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* ===== FETCH: serve cached, generate icons on-the-fly ===== */
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Generate PNG icons dynamically via OffscreenCanvas
  if (url.pathname.includes('/icons/icon-') && url.pathname.endsWith('.png')) {
    const size = url.pathname.includes('512') ? 512 : 192;
    e.respondWith(generateIcon(size));
    return;
  }

  // Cache-first for shell assets
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200 && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => {
        // Offline fallback: return cached index.html for navigation
        if (e.request.mode === 'navigate') return caches.match('/index.html');
      });
    })
  );
});

/* ===== ICON GENERATOR ===== */
async function generateIcon(size) {
  try {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    const r = size * 0.2; // corner radius

    // Blue rounded background
    ctx.fillStyle = '#2564CF';
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(size - r, 0);
    ctx.quadraticCurveTo(size, 0, size, r);
    ctx.lineTo(size, size - r);
    ctx.quadraticCurveTo(size, size, size - r, size);
    ctx.lineTo(r, size);
    ctx.quadraticCurveTo(0, size, 0, size - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.fill();

    // White checkmark
    const lw = size * 0.1;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(size * 0.22, size * 0.52);
    ctx.lineTo(size * 0.44, size * 0.72);
    ctx.lineTo(size * 0.78, size * 0.30);
    ctx.stroke();

    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Response(blob, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
      }
    });
  } catch (err) {
    // Fallback: redirect to SVG icon
    return fetch('/icons/icon.svg');
  }
}

/* ===== PUSH NOTIFICATIONS ===== */
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : { title: '할 일 알림', body: '알림이 있습니다.' };
  e.waitUntil(
    self.registration.showNotification(data.title || '할 일 알림', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || 'todo',
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('/'));
});
