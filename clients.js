'use strict';
/* ============================================================
   clients.js — صفحة الزبائن (قائمة + بطاقة + بحث عائم) وصفحة التحليلات المتقدمة
   ============================================================ */

const C = { region: null, sort: 'name', detail: null, returnPage: 'clients', totals: null, searchActive: false };

function clientTotals() {
  if (C.totals) return C.totals;
  const t = {};
  DATA.clients.forEach(c => {
    const sh = DATA.shipsBy[c.code] || [], py = DATA.paysBy[c.code] || [], vs = DATA.visitsBy[c.code] || [];
    t[c.code] = {
      shipments: sh.length,
      revenue: py.reduce((a, r) => a + r.amount, 0),
      visits: vs.filter(v => v.success).length
    };
  });
  C.totals = t;
  return t;
}

// ---------- القائمة ----------
function renderClients() {
  const root = $('content-clients');
  if (C.detail) { renderClientDetail(C.detail); return; }
  const all = ['الكل'].concat(DATA.regions);
  let html = '<div class="region-pills" id="regionPills">' + all.map(r =>
    '<button class="region-pill' + (C.region === r ? ' active' : '') + '" data-region="' + esc(r) + '">' + esc(r) + '</button>').join('') + '</div>';
  html += '<div class="sort-tabs" id="sortTabs">' + [
    ['name', 'أبجديًا'], ['shipments', '🚚 الشحنات'], ['visits', '📍 زيارات ناجحة'], ['revenue', '💰 المداخيل']
  ].map(s => '<button class="sort-tab' + (C.sort === s[0] ? ' active' : '') + '" data-sort="' + s[0] + '">' + s[1] + '</button>').join('') + '</div>';
  html += '<div id="searchResults" class="search-results"></div><div id="clientsList" class="clients-list"></div>';
  root.innerHTML = html;

  root.querySelectorAll('.region-pill').forEach(b => b.addEventListener('click', () => { C.region = b.dataset.region; renderClients(); }));
  root.querySelectorAll('.sort-tab').forEach(b => b.addEventListener('click', () => { C.sort = b.dataset.sort; renderClients(); }));
  renderClientsList();
}

function renderClientsList() {
  const box = $('clientsList');
  if (!C.region) { box.innerHTML = '<p class="muted">اختر منطقة لعرض الزبائن</p>'; return; }
  const tot = clientTotals();
  const list = DATA.clients.filter(c => C.region === 'الكل' || c.region === C.region).map(c => ({
    code: c.code, name: c.name, wilaya: c.wilaya, region: c.region,
    shipments: tot[c.code].shipments, revenue: tot[c.code].revenue, visits: tot[c.code].visits
  }));
  if (!list.length) { box.innerHTML = '<p class="muted">لا يوجد زبائن في هذه المنطقة</p>'; return; }
  list.sort((a, b) => C.sort === 'name' ? a.name.localeCompare(b.name, 'ar') : b[C.sort] - a[C.sort]);
  box.innerHTML = list.map(c =>
    '<button class="browse-card" data-code="' + esc(c.code) + '"><div class="browse-card-main">' +
    '<span class="browse-name">' + esc(c.name) + '</span>' +
    '<span class="browse-sub">' + esc([c.wilaya, c.region].filter(Boolean).join(' · ')) + '</span></div>' +
    '<div class="browse-card-stats"><span title="شحنات">🚚 ' + c.shipments + '</span><span title="زيارات ناجحة">📍 ' + c.visits +
    '</span><span title="مداخيل">💰 ' + fmtNum(c.revenue) + '</span></div></button>').join('');
  box.querySelectorAll('.browse-card').forEach(b => b.addEventListener('click', () => openClient(b.dataset.code)));
}

// ---------- بطاقة الزبون ----------
function openClient(code) {
  C.returnPage = CURRENT_PAGE;
  C.detail = code;
  if (CURRENT_PAGE !== 'clients') navigateTo('clients', { keepDetail: true }); else renderClients();
}

function closeClient() {
  const back = C.returnPage;
  C.detail = null;
  C.searchActive = false;
  setFabIcon_('🔍');
  C.returnPage = 'clients';
  if (back && back !== 'clients') navigateTo(back); else renderClients();
}

function renderClientDetail(code) {
  const c = DATA.clientByCode[code];
  const root = $('content-clients');
  if (!c) { root.innerHTML = '<div class="error-box">لم يتم إيجاد زبون بهذا الكود: ' + esc(code) + '</div>'; return; }
  const ships = DATA.shipsBy[code] || [], pays = DATA.paysBy[code] || [], vis = DATA.visitsBy[code] || [];
  const bal = DATA.bal[code] || { cr: 0, dt: 0 };
  const lastSale = c.lastSale ? fmtDate(c.lastSale) : '—';

  const tl = [];
  ships.forEach(r => tl.push({ type: 'shipment', date: r.date, title: 'شحنة (' + (r.colis || '?') + ' كولي)',
    detail: [r.transport, r.call ? 'تأكيد: ' + r.call : '', r.remark].filter(Boolean).join(' — ') }));
  pays.forEach(r => tl.push({ type: 'payment', date: r.date, title: 'دفعة: ' + fmtNum(r.amount) + ' دج', detail: r.rep && r.rep !== 'غير محدد' ? 'المندوب: ' + r.rep : '' }));
  vis.forEach(r => tl.push({ type: 'visit', date: r.date, title: 'زيارة: ' + r.note, detail: r.rep && r.rep !== 'غير محدد' ? 'المندوب: ' + r.rep : '' }));
  tl.sort((a, b) => (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0));
  const ICON = { shipment: '🚚', payment: '💰', visit: '📍' };

  let html = '<button id="backBtn" class="back-btn">→ رجوع</button><div class="client-card">';
  html += '<h2 class="client-name">' + esc(c.name) + '</h2>';
  html += '<div class="client-meta">' + esc([c.wilaya, c.ville, c.region].filter(Boolean).join(' · ')) + '</div>';
  if (c.tel) html += '<a class="client-tel" href="tel:' + esc(c.tel) + '">📞 ' + esc(c.tel) + '</a>';
  html += statRow([
    { label: 'الشحنات', value: fmtNum(ships.length) },
    { label: 'الكوليات', value: fmtNum(ships.reduce((a, r) => a + r.colis, 0)) },
    { label: 'الدفعات', value: fmtNum(pays.reduce((a, r) => a + r.amount, 0)) + ' دج' },
    { label: 'الزيارات', value: fmtNum(vis.length) }
  ]);
  html += '<div class="client-extra">آخر بيع: ' + lastSale + '</div>';
  if (bal.cr) html += '<div class="client-extra">CREANCE: ' + fmtNum(bal.cr) + ' دج</div>';
  if (bal.dt) html += '<div class="client-extra">DETTE: ' + fmtNum(bal.dt) + ' دج</div>';
  if (/^https?:\/\//.test(c.address || '')) html += '<a class="client-tel" href="' + esc(c.address) + '" target="_blank" rel="noopener">📍 الموقع على الخريطة</a>';
  html += '</div><h3 class="timeline-title">السجل الزمني</h3>';
  if (!tl.length) html += '<p class="muted">لا يوجد أي سجل لهذا الزبون بعد.</p>';
  else html += '<div class="timeline">' + tl.map(t =>
    '<div class="timeline-item ' + t.type + '"><div class="timeline-icon">' + ICON[t.type] + '</div><div class="timeline-body">' +
    '<div class="timeline-date">' + fmtDate(t.date) + '</div><div class="timeline-title-text">' + esc(t.title) + '</div>' +
    (t.detail ? '<div class="timeline-detail">' + esc(t.detail) + '</div>' : '') + '</div></div>').join('') + '</div>';
  root.innerHTML = html;
  $('backBtn').addEventListener('click', closeClient);
  window.scrollTo(0, 0);
}

// ---------- 🔍 أيقونة البحث العائمة القابلة للسحب ----------
const fab = { el: null, panel: null, input: null, open: false, dragged: false, down: false, sx: 0, sy: 0, fx: 0, fy: 0 };

function setFabIcon_(t) { if (fab.el) fab.el.textContent = t; }

function positionFab_(x, y) {
  const maxX = window.innerWidth - 60, maxY = window.innerHeight - 60;
  fab.el.style.left = Math.min(Math.max(8, x), maxX) + 'px';
  fab.el.style.top = Math.min(Math.max(8, y), maxY) + 'px';
  fab.el.style.right = 'auto';
}
function positionPanel_() {
  const r = fab.el.getBoundingClientRect(), w = 230;
  let left = r.left + r.width + 10;
  if (left + w > window.innerWidth - 8) left = r.left - w - 10;
  if (left < 8) left = 8;
  fab.panel.style.left = left + 'px';
  fab.panel.style.top = Math.max(8, r.top - 6) + 'px';
}
function toggleSearch_() {
  if (C.searchActive) {            // الأيقونة الآن ✖ => إلغاء البحث
    fab.input.value = '';
    C.searchActive = false; setFabIcon_('🔍');
    if (C.detail) closeClient(); else renderClients();
    return;
  }
  fab.open = !fab.open;
  if (fab.open) { positionPanel_(); fab.panel.classList.add('open'); setTimeout(() => fab.input.focus(), 100); }
  else fab.panel.classList.remove('open');
}

function searchClientsLocal(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const starts = [], contains = [];
  DATA.clients.forEach(c => {
    const n = c.name.toLowerCase(), k = String(c.code).toLowerCase();
    if (n.indexOf(q) === 0 || k.indexOf(q) === 0) starts.push(c);
    else if (n.indexOf(q) !== -1 || k.indexOf(q) !== -1) contains.push(c);
  });
  return starts.concat(contains).slice(0, 20);
}

function initFab() {
  fab.el = $('searchFab'); fab.panel = $('searchPanel'); fab.input = $('clientSearchInput');
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('ceo_fab_pos')); } catch (e) {}
  if (saved && saved.x != null) positionFab_(saved.x, saved.y); else positionFab_(20, window.innerHeight * 0.65);

  fab.el.addEventListener('pointerdown', e => {
    fab.down = true; fab.dragged = false; fab.sx = e.clientX; fab.sy = e.clientY;
    const r = fab.el.getBoundingClientRect(); fab.fx = r.left; fab.fy = r.top;
    fab.el.setPointerCapture(e.pointerId);
  });
  fab.el.addEventListener('pointermove', e => {
    if (!fab.down) return;
    const dx = e.clientX - fab.sx, dy = e.clientY - fab.sy;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) fab.dragged = true;
    if (fab.dragged) { positionFab_(fab.fx + dx, fab.fy + dy); if (fab.open) positionPanel_(); }
  });
  fab.el.addEventListener('pointerup', () => {
    fab.down = false;
    if (fab.dragged) {
      const r = fab.el.getBoundingClientRect();
      try { localStorage.setItem('ceo_fab_pos', JSON.stringify({ x: r.left, y: r.top })); } catch (e) {}
    } else toggleSearch_();
  });

  fab.input.addEventListener('input', () => {
    const q = fab.input.value;
    if (CURRENT_PAGE !== 'clients') return;
    if (C.detail) { C.detail = null; renderClients(); }
    const box = $('searchResults'), list = $('clientsList');
    if (!box) return;
    if (!q.trim()) { box.innerHTML = ''; list.style.display = ''; return; }
    const res = searchClientsLocal(q);
    list.style.display = res.length ? 'none' : '';
    box.innerHTML = res.length ? res.map(r =>
      '<button class="result-item" data-code="' + esc(r.code) + '"><span class="result-name">' + esc(r.name) +
      '</span><span class="result-sub">' + esc(r.wilaya || '') + '</span></button>').join('') : '<p class="muted">لا توجد نتائج</p>';
    box.querySelectorAll('.result-item').forEach(b => b.addEventListener('click', () => {
      C.searchActive = true; setFabIcon_('✖');
      fab.panel.classList.remove('open'); fab.open = false;
      C.returnPage = 'clients'; C.detail = b.dataset.code; renderClients();
    }));
  });
}

// ============================================================
// التحليلات المتقدمة (في المتصفح — تتأثر بفلتر المناطق)
// ============================================================
function renderAnalytics() {
  const now = new Date(), curYm = ymOf(now), lastYm = curYm - 1;
  const d60 = new Date(now.getTime() - 60 * 86400000), d180 = new Date(now.getTime() - 180 * 86400000);
  const inReg = r => !S.regions.size || S.regions.has(r);
  const clients = DATA.clients.filter(c => inReg(c.region));

  const enriched = clients.map(c => {
    const sh = DATA.shipsBy[c.code] || [], py = DATA.paysBy[c.code] || [], vs = DATA.visitsBy[c.code] || [];
    let lastShip = null, s6 = 0, col6 = 0, sThis = 0, sLast = 0, s60 = 0;
    sh.forEach(r => {
      if (!r.date) return;
      if (r.date >= d180) { s6++; col6 += r.colis; }
      if (r.ym === curYm) sThis++;
      if (r.ym === lastYm) sLast++;
      if (r.date >= d60) s60++;
      if (!lastShip || r.date > lastShip) lastShip = r.date;
    });
    const v60 = vs.filter(v => v.date && v.date >= d60).length;
    const lastSale = c.lastSale || lastShip;
    const bal = DATA.bal[c.code] || { cr: 0, dt: 0 };
    return {
      code: c.code, name: c.name, region: c.region, shipments6m: s6, colis6m: col6, shipmentsThis: sThis, shipmentsLast: sLast, shipments60d: s60,
      paymentsTotal: py.reduce((a, r) => a + r.amount, 0), paymentsCount: py.length,
      visitsTotal: vs.length, visits60d: v60, creance: bal.cr,
      daysSinceLastSale: lastSale ? daysBetween(now, lastSale) : null,
      daysSinceCreated: c.created ? daysBetween(now, c.created) : null
    };
  });

  const desc = (arr, f) => [...arr].sort((a, b) => f(b) - f(a));
  const mostActive = desc(enriched.map(c => ({ ...c, score: c.shipments6m + c.visitsTotal + c.paymentsCount })), c => c.score).slice(0, 15);
  const stopped = n => enriched.filter(c => c.daysSinceLastSale === null || c.daysSinceLastSale > n).length;
  const stoppedList = desc(enriched.filter(c => c.daysSinceLastSale !== null), c => c.daysSinceLastSale).slice(0, 15);
  const withDelta = enriched.filter(c => c.shipmentsThis > 0 || c.shipmentsLast > 0).map(c => ({ ...c, delta: c.shipmentsThis - c.shipmentsLast }));
  const increasing = desc(withDelta.filter(c => c.delta > 0), c => c.delta).slice(0, 10);
  const decreasing = [...withDelta.filter(c => c.delta < 0)].sort((a, b) => a.delta - b.delta).slice(0, 10);
  const mostVisited = desc(enriched.filter(c => c.visitsTotal > 0), c => c.visitsTotal).slice(0, 10);
  const visitedNoActivity = desc(enriched.filter(c => c.visits60d > 0 && c.shipments60d === 0), c => c.visits60d).slice(0, 15);

  const rep = {};
  DATA.visits.filter(v => inReg(v.region)).forEach(v => {
    const o = rep[v.rep] || (rep[v.rep] = { total: 0, done: 0 });
    o.total++; if (v.success) o.done++;
  });
  const repPerf = Object.keys(rep).map(k => ({ rep: k, total: rep[k].total, done: rep[k].done, pct: rep[k].total ? Math.round(rep[k].done / rep[k].total * 100) : 0 })).sort((a, b) => b.total - a.total);

  const debtRisk = desc(enriched.filter(c => c.creance > 0).map(c => ({ ...c, ratio: c.creance / (c.paymentsTotal || 1) })), c => c.ratio).slice(0, 15);
  const mx = f => Math.max(1, ...enriched.map(f));
  const mS = mx(c => c.shipments6m), mP = mx(c => c.paymentsTotal), mV = mx(c => c.visitsTotal);
  const best = desc(enriched.map(c => ({ ...c, comp: c.shipments6m / mS + c.paymentsTotal / mP + c.visitsTotal / mV })), c => c.comp).slice(0, 15);
  const risk = desc(enriched.filter(c => c.shipments6m >= 3 && c.shipmentsThis === 0 && c.visits60d === 0), c => c.shipments6m).slice(0, 15);
  const newCount = enriched.filter(c => c.daysSinceCreated !== null && c.daysSinceCreated <= 90).length;

  const rm = {};
  enriched.forEach(c => {
    const o = rm[c.region] || (rm[c.region] = { total: 0, inactive: 0, ship: 0, pay: 0, vis: 0 });
    o.total++; if (c.daysSinceLastSale === null || c.daysSinceLastSale > 90) o.inactive++;
    o.ship += c.shipments6m; o.pay += c.paymentsTotal; o.vis += c.visitsTotal;
  });
  const rs = Object.values(rm);
  const rMS = Math.max(1, ...rs.map(r => r.ship)), rMP = Math.max(1, ...rs.map(r => r.pay)), rMV = Math.max(1, ...rs.map(r => r.vis));
  const regionRank = Object.keys(rm).map(k => ({ region: k, ...rm[k], score: rm[k].ship / rMS + rm[k].pay / rMP + rm[k].vis / rMV })).sort((a, b) => b.score - a.score);

  const item = (c, label) => '<button class="ranked-item clickable" data-client="' + esc(c.code) + '"><span class="rank-name">' + esc(c.name) +
    ' <span class="rank-sub">' + esc(c.region || '') + '</span></span><span class="rank-value">' + label + '</span></button>';
  const block = (title, arr, empty) => '<h3 class="section-title">' + title + '</h3>' +
    (arr.length ? '<div class="ranked-list">' + arr.join('') + '</div>' : '<p class="muted">' + empty + '</p>');

  let html = '<p class="period-note">📍 ' + esc(regionLabel()) + '</p>';
  html += block('🏆 الزبائن الأكثر نشاطًا (6 أشهر)', mostActive.map(c => item(c, c.score + ' نقطة نشاط')), 'لا توجد بيانات');
  html += '<h3 class="section-title">⏸️ توقفوا عن الشراء</h3>' + statRow([
    { label: 'أكثر من 30 يوم', value: fmtNum(stopped(30)) }, { label: 'أكثر من 60 يوم', value: fmtNum(stopped(60)) }, { label: 'أكثر من 90 يوم', value: fmtNum(stopped(90)) }]);
  html += block('الأطول توقفًا', stoppedList.map(c => item(c, c.daysSinceLastSale + ' يوم')), 'لا يوجد');
  html += block('📈 نشاط متزايد هذا الشهر', increasing.map(c => item(c, '+' + c.delta + ' شحنة')), 'لا يوجد تغيّر ملحوظ');
  html += block('📉 نشاط متناقص هذا الشهر', decreasing.map(c => item(c, c.delta + ' شحنة')), 'لا يوجد تغيّر ملحوظ');
  html += block('📍 الأكثر زيارة', mostVisited.map(c => item(c, c.visitsTotal + ' زيارة')), 'لا توجد بيانات');
  html += block('⚠️ زيارات كثيرة بلا نشاط شحن (آخر 60 يوم)', visitedNoActivity.map(c => item(c, c.visits60d + ' زيارة، 0 شحنة')), 'لا يوجد — كل من تمت زيارته لديه نشاط 👍');
  html += '<h3 class="section-title">👥 أداء المناديب في المتابعة</h3>' + (repPerf.length
    ? '<div class="ranked-list">' + repPerf.map(r => '<div class="ranked-item"><span class="rank-name">' + esc(r.rep) + '</span><span class="rank-value">' + r.done + '/' + r.total + ' (' + r.pct + '%)</span></div>').join('') + '</div>'
    : '<p class="muted">لا توجد بيانات</p>');
  html += block('💸 ديون كبيرة مقارنة بالدفع (CREANCE مقابل المدفوع)', debtRisk.map(c => item(c, fmtNum(c.creance) + ' دج (× ' + c.ratio.toFixed(1) + ' من مدفوعاته)')), 'لا توجد ديون ملحوظة');
  html += block('⭐ أفضل الزبائن (شحنات + دفعات + زيارات مجتمعة)', best.map(c => item(c, c.comp.toFixed(2))), 'لا توجد بيانات كافية');
  html += block('🚨 زبائن يمثلون خطر فقدان', risk.map(c => item(c, 'كان نشطًا (' + c.shipments6m + ' شحنة/6أشهر) — صفر هذا الشهر')), 'لا يوجد زبائن في خطر حاليًا 👍');
  html += '<h3 class="section-title">🆕 زبائن جدد مقابل قدامى</h3>' + statRow([
    { label: 'جدد (آخر 90 يوم)', value: fmtNum(newCount) }, { label: 'قدامى', value: fmtNum(enriched.length - newCount) }]);
  html += '<h3 class="section-title">🗺️ ترتيب المناطق حسب الأداء المركّب</h3><div class="ranked-list">' + regionRank.map((r, i) =>
    '<div class="ranked-item"><span class="rank">' + (i + 1) + '</span><span class="rank-name">' + esc(r.region) +
    ' <span class="rank-sub">' + r.total + ' زبون، ' + r.inactive + ' غير نشط</span></span><span class="rank-value">' + r.score.toFixed(2) + '</span></div>').join('') + '</div>';

  $('content-analytics').innerHTML = html;
  bindClientLinks($('content-analytics'));
}
