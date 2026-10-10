'use strict';
/* ============================================================
   main.js — تنقّل، شريط الفلاتر، الوضع الليلي، تحميل البيانات
   ============================================================ */

let CURRENT_PAGE = 'overview';
let OPEN_FILTER = null;

const PAGE_RENDER = {
  overview: () => renderOverview(), clients: () => renderClients(), shipments: () => renderShipments(),
  revenue: () => renderRevenue(), visits: () => renderVisits(), analytics: () => renderAnalytics()
};
const PAGE_FILTERS = {
  overview: ['regions'], clients: [], shipments: ['regions', 'months', 'years'],
  revenue: ['regions', 'months', 'years'], visits: ['regions', 'months', 'years'], analytics: ['regions']
};
const EXTRA_FILTERS = {   // فلاتر ثانوية تُفعَّل بالضغط على الرسوم
  shipments: [['wilaya', 'ولاية'], ['transport', 'نقل']],
  revenue: [['rep', 'مندوب']], visits: [['rep', 'مندوب']]
};

let DATA_READY = false;

function refreshAll() {
  if (!DATA_READY) return;
  applyFilters();
  renderFilterBar();
  renderCurrent();
}
function renderCurrent() {
  if (!DATA_READY) return;
  disposeCharts();
  try { PAGE_RENDER[CURRENT_PAGE](); }
  catch (e) { console.error(e); $('content-' + CURRENT_PAGE).innerHTML = '<div class="error-box">⚠️ ' + esc(e.message) + '</div>'; }
}

function navigateTo(page, opts) {
  opts = opts || {};
  if (!opts.keepDetail) C.detail = null;
  CURRENT_PAGE = page;
  OPEN_FILTER = null;
  document.querySelectorAll('.page').forEach(p => { p.style.display = 'none'; });
  $('page-' + page).style.display = 'block';
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  const isClients = page === 'clients';
  $('searchFab').style.display = isClients ? 'flex' : 'none';
  if (!isClients) { $('searchPanel').classList.remove('open'); fab.open = false; }
  window.scrollTo(0, 0);
  refreshAll();
}

// ---------- شريط الفلاتر ----------
const FILTER_DEFS = {
  regions: { label: '📍 المنطقة', set: () => S.regions, options: () => DATA.regions.map(r => [r, r]), empty: 'كل المناطق' },
  months: { label: '🗓️ الشهر', set: () => S.months, options: () => MONTH_NAMES.map((n, i) => [i + 1, n]), empty: 'الشهر الحالي' },
  years: { label: '📆 السنة', set: () => S.years, options: () => DATA.years.map(y => [y, String(y)]), empty: 'السنة الحالية' }
};

function filterSummary(key) {
  const def = FILTER_DEFS[key], set = def.set();
  if (!set.size) return def.empty;
  const opts = def.options();
  const names = Array.from(set).map(v => { const o = opts.find(x => x[0] === v); return o ? o[1] : v; });
  return names.length <= 2 ? names.join('، ') : names.length + ' محدَّدة';
}

function renderFilterBar() {
  const fb = $('filterBar'), show = PAGE_FILTERS[CURRENT_PAGE] || [];
  fb.style.display = show.length ? 'block' : 'none';
  if (!show.length) return;

  let html = '<div class="fb-row">' + show.map(k =>
    '<button class="fb-btn' + (FILTER_DEFS[k].set().size ? ' on' : '') + (OPEN_FILTER === k ? ' open' : '') + '" data-f="' + k + '">' +
    '<span class="fb-lab">' + FILTER_DEFS[k].label + '</span><span class="fb-val">' + esc(filterSummary(k)) + '</span></button>').join('') +
    '<button class="fb-clear" id="fbClear" title="مسح كل الفلاتر">✖</button></div>';

  // شرائح الفلاتر الثانوية
  const chips = [];
  (EXTRA_FILTERS[CURRENT_PAGE] || []).forEach(([k, lab]) => {
    S[k].forEach(v => chips.push('<button class="fb-chip" data-k="' + k + '" data-v="' + esc(v) + '">' + lab + ': ' + esc(v) + ' ✖</button>'));
  });
  if (chips.length) html += '<div class="fb-chips">' + chips.join('') + '</div>';

  if (OPEN_FILTER && show.indexOf(OPEN_FILTER) !== -1) {
    const def = FILTER_DEFS[OPEN_FILTER], set = def.set();
    html += '<div class="fb-panel">' + def.options().map(o =>
      '<button class="fb-opt' + (set.has(o[0]) ? ' sel' : '') + '" data-v="' + esc(o[0]) + '">' + esc(o[1]) + '</button>').join('') + '</div>';
  }
  fb.innerHTML = html;

  fb.querySelectorAll('.fb-btn').forEach(b => b.addEventListener('click', () => {
    OPEN_FILTER = OPEN_FILTER === b.dataset.f ? null : b.dataset.f; renderFilterBar();
  }));
  $('fbClear').addEventListener('click', () => {
    Object.keys(S).forEach(k => S[k].clear()); OPEN_FILTER = null; refreshAll();
  });
  fb.querySelectorAll('.fb-chip').forEach(b => b.addEventListener('click', () => {
    S[b.dataset.k].delete(b.dataset.v); refreshAll();
  }));
  fb.querySelectorAll('.fb-opt').forEach(b => b.addEventListener('click', () => {
    const def = FILTER_DEFS[OPEN_FILTER], set = def.set();
    const raw = def.options().find(o => String(o[0]) === b.dataset.v);
    if (raw) toggleIn(set, raw[0]);
    refreshAll();
  }));
}

document.addEventListener('click', e => {
  // composedPath (وليس closest): إعادة رسم الشريط تفصل العنصر المضغوط من الصفحة قبل وصول الحدث إلى هنا
  const inside = e.composedPath().some(el => el.id === 'filterBar');
  if (OPEN_FILTER && !inside) { OPEN_FILTER = null; renderFilterBar(); }
});

// ---------- الوضع الليلي ----------
function applyDark(on) {
  document.body.classList.toggle('dark', on);
  $('darkModeBtn').textContent = on ? '☀️' : '🌙';
}
function setupDark() {
  let saved = null;
  try { saved = localStorage.getItem('ceo_dark_mode'); } catch (e) {}
  applyDark(saved === '1' || (saved === null && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches));
  $('darkModeBtn').addEventListener('click', () => {
    const on = !document.body.classList.contains('dark');
    applyDark(on);
    try { localStorage.setItem('ceo_dark_mode', on ? '1' : '0'); } catch (e) {}
    renderCurrent();
  });
}

// ---------- القائمة الجانبية ----------
function setupNav() {
  const nav = $('sideNav'), ov = $('navOverlay');
  const close = () => { nav.classList.remove('open'); ov.classList.remove('open'); };
  $('menuBtn').addEventListener('click', () => { nav.classList.add('open'); ov.classList.add('open'); });
  ov.addEventListener('click', close);
  document.querySelectorAll('.nav-item').forEach(b => b.addEventListener('click', () => { close(); navigateTo(b.dataset.page); }));
}

// ---------- تحميل البيانات ----------
function setStatus(t) { $('statusText').textContent = t; }
function showBoot(html, isError) {
  const b = $('boot');
  b.style.display = 'block';
  b.className = isError ? 'error-box' : 'loading';
  b.innerHTML = html;
}
function hideBoot() { $('boot').style.display = 'none'; }

function loadFromPayload(p) {
  prepareData(p);
  C.totals = null;
  buildCrossfilter();
  DATA_READY = true;
  hideBoot();
  navigateTo(CURRENT_PAGE, { keepDetail: !!C.detail });
}

async function fetchAndApply(force) {
  setStatus('⏳ جاري التحديث…');
  $('refreshBtn').classList.add('spinning');
  try {
    const fresh = await fetchPayload(force);
    loadFromPayload(fresh);
    IDB.set('payload', fresh);
    setStatus('✅ ' + lastUpdateText());
  } catch (e) {
    console.error(e);
    if (DATA_READY) setStatus('⚠️ تعذّر التحديث — تُعرض آخر نسخة محفوظة');
    else showBoot('⚠️ ' + esc(e.message), true);
  } finally {
    $('refreshBtn').classList.remove('spinning');
  }
}

// ---------- PWA: تسجيل service worker + زر التثبيت ----------
let deferredInstall = null;
function setupPwa() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW:', e));
  }
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstall = e;
    $('installBtn').style.display = '';
  });
  $('installBtn').addEventListener('click', async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice.catch(() => {});
    deferredInstall = null;
    $('installBtn').style.display = 'none';
  });
  window.addEventListener('appinstalled', () => { $('installBtn').style.display = 'none'; });
}

async function init() {
  setupPwa(); setupDark(); setupNav(); initFab();
  $('refreshBtn').addEventListener('click', () => fetchAndApply(true));
  $('searchFab').style.display = 'none';

  if (!apiConfigured()) {
    showBoot('⚙️ لم يتم ضبط رابط Apps Script بعد.<br>افتح الملف <b>config.js</b> وضع رابط تطبيق الويب (ينتهي بـ /exec).', true);
    return;
  }
  const cached = await IDB.get('payload');
  if (cached) {
    try { loadFromPayload(cached); setStatus('📦 نسخة محفوظة — جاري التحديث…'); } catch (e) { console.error(e); }
  } else {
    showBoot('<div class="spinner"></div><p>جاري تحميل البيانات لأول مرة…</p>');
  }
  fetchAndApply(false);
}

document.addEventListener('DOMContentLoaded', init);
