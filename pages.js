'use strict';
/* ============================================================
   pages.js — النظرة العامة، الشحنات، المداخيل، الزيارات
   (كلها تقرأ من Crossfilter / الذاكرة مباشرة — لا اتصال بالخادم)
   ============================================================ */

const $ = id => document.getElementById(id);
function mount(id, option, onClick, onCategory) { const el = $(id); if (el) mountChart(el, option, onClick, onCategory); }

function periodLabel() {
  const { months, years } = effectivePeriod();
  const m = Array.from(months).sort((a, b) => a - b).map(x => MONTH_NAMES[x - 1]).join('، ');
  const y = Array.from(years).sort().join('، ');
  return m + ' ' + y;
}
function regionLabel() { return S.regions.size ? Array.from(S.regions).join('، ') : 'كل المناطق'; }
function periodNote() {
  return '<p class="period-note">📅 ' + esc(periodLabel()) + ' &nbsp;·&nbsp; 📍 ' + esc(regionLabel()) +
    ' <span class="hint-text">(اضغط على أي عمود أو نقطة للتصفية به)</span></p>';
}
function emptyNote(msg) { return '<p class="muted">' + (msg || 'لا توجد بيانات لهذه الفلاتر') + '</p>'; }
function lastUpdateText() { return 'آخر تحديث: ' + (DATA.generatedAt ? DATA.generatedAt.toLocaleString('ar-DZ') : '—'); }

/** اضغط على أي مكان في عمود شهر بالمنحنى = اختر ذلك الشهر والسنة */
function trendClickHandler(yms) {
  return idx => {
    const ym = yms[idx];
    if (ym === undefined) return;
    S.months = new Set([(ym % 12) + 1]);
    S.years = new Set([Math.floor(ym / 12)]);
    refreshAll();
  };
}

// ---------- أهداف شهرية (محفوظة في المتصفح) ----------
function getTargets() { try { return JSON.parse(localStorage.getItem('ceo_targets')) || {}; } catch (e) { return {}; } }
function setTargets(t) { try { localStorage.setItem('ceo_targets', JSON.stringify(t)); } catch (e) {} }

// ---------- مؤشرات ----------
function changeHtml(cur, prev, days) {
  if (!prev) return '<div class="kpi-sub flat">لا توجد بيانات للمقارنة</div>';
  const pct = ((cur - prev) / prev) * 100;
  const cls = pct > 0 ? 'up' : (pct < 0 ? 'down' : 'flat');
  const arrow = pct > 0 ? '▲' : (pct < 0 ? '▼' : '—');
  return '<div class="kpi-sub ' + cls + '">' + arrow + ' ' + Math.abs(pct).toFixed(0) + '% مقارنة بأول ' + days + ' يوم من الشهر الماضي</div>';
}
function heroCard(icon, accent, label, value, subHtml, targetVal, curVal) {
  let prog = '';
  if (targetVal > 0) {
    const pct = Math.round(curVal / targetVal * 100);
    prog = '<div class="target-bar"><span style="width:' + Math.min(100, pct) + '%"></span></div>' +
      '<div class="kpi-formula">' + pct + '% من هدف الشهر (' + fmtNum(targetVal) + ')</div>';
  }
  return '<div class="hero-card" style="--kpi-accent:' + accent + '"><div class="kpi-icon" style="background:' + accent + '">' + icon + '</div>' +
    '<div class="hero-body"><div class="kpi-label">' + label + '</div><div class="hero-value">' + value + '</div>' + (subHtml || '') + prog + '</div></div>';
}

// ---------- أدوات بيانات مشتركة ----------
function maxDate(rows, field) {
  let m = 0;
  (rows || []).forEach(r => { const t = r[field] ? r[field].getTime() : 0; if (t > m) m = t; });
  return m ? new Date(m) : null;
}
function lastVisitDate(code) {
  let m = 0;
  (DATA.visitsBy[code] || []).forEach(v => { if (v.ts > m) m = v.ts; });
  return m ? new Date(m) : null;
}

/** خريطة حرارية: كل المناطق × آخر 6 أشهر (لا تتأثر بفلتر المنطقة ليبقى التقارن ممكنًا) */
function heatData(rows, valueFn) {
  const yms = last6Yms();
  const regs = DATA.regions.slice();
  const acc = {};
  rows.forEach(r => {
    if (r.ym < yms[0] || r.ym > yms[5]) return;
    const k = r.region + '|' + r.ym;
    acc[k] = (acc[k] || 0) + valueFn(r);
  });
  let max = 0;
  const matrix = [];
  regs.forEach((reg, ri) => yms.forEach((ym, ci) => {
    const v = acc[reg + '|' + ym] || 0;
    if (v > max) max = v;
    matrix.push([ci, ri, v]);
  }));
  return { yms, regs, matrix, max };
}
function heatClickHandler(h) {
  return p => {
    const reg = h.regs[p.value[1]], ym = h.yms[p.value[0]];
    toggleIn(S.regions, reg);
    S.months = new Set([(ym % 12) + 1]);
    S.years = new Set([Math.floor(ym / 12)]);
    refreshAll();
  };
}

/** ملاحظات جودة البيانات */
function dataQualityIssues() {
  const known = DATA.clientByCode;
  const issues = [];
  // كل ملاحظة تحمل صفوفها: السطر في الشيت + التاريخ + الزبون + تفصيل
  const nameOf = (r, fallback) => (known[r.code] && known[r.code].name) || fallback || '';
  const add = (label, sheet, rows, map) => {
    if (!rows.length) return;
    const items = rows.map(map).sort((a, b) => (a.row || 1e9) - (b.row || 1e9));
    issues.push({ label, sheet, n: items.length, items });
  };
  const shipItem = r => ({ row: r.row, date: r.date, code: r.code, name: nameOf(r), info: r.colis ? r.colis + ' طرد' : '' });
  const payItem = r => ({ row: r.row, date: r.date, code: r.code, name: nameOf(r, r.clientName), info: r.amount ? fmtNum(r.amount) + ' دج' : '' });
  const visItem = r => ({ row: r.row, date: r.date, code: r.code, name: nameOf(r), info: r.rep && r.rep !== 'غير محدد' ? r.rep : '' });

  add('شحنات بلا تاريخ صالح', 'GLOBAL', DATA.ships.filter(r => !r.date), shipItem);
  add('شحنات بلا كود زبون', 'GLOBAL', DATA.ships.filter(r => !r.code), shipItem);
  add('شحنات بكود غير موجود في CLIENT', 'GLOBAL', DATA.ships.filter(r => r.code && !known[r.code]), shipItem);
  add('دفعات بلا تاريخ صالح', 'المداخيل', DATA.pays.filter(r => !r.date), payItem);
  add('دفعات بلا كود زبون (لا تُحسب لمنطقة)', 'المداخيل', DATA.pays.filter(r => !r.code), payItem);
  add('دفعات بكود غير موجود في CLIENT', 'المداخيل', DATA.pays.filter(r => r.code && !known[r.code]), payItem);
  add('زيارات بلا تاريخ صالح', 'CustomerLog', DATA.visits.filter(r => !r.date), visItem);
  add('زيارات بكود غير موجود في CLIENT', 'CustomerLog', DATA.visits.filter(r => r.code && !known[r.code]), visItem);
  add('زبائن بلا منطقة', 'CLIENT', DATA.clients.filter(c => c.region === 'غير محدد'),
    c => ({ row: c.row, date: c.created, code: c.code, name: c.name === c.code ? '' : c.name, info: c.wilaya || '' }));
  return issues;
}
function dataQualityHtml() {
  const is = dataQualityIssues();
  if (!is.length) return '<p class="muted">✅ لا توجد ملاحظات على جودة البيانات.</p>';
  const LIMIT = 300;
  return '<div class="dq-list">' + is.map(i => {
    const shown = i.items.slice(0, LIMIT);
    const noRows = i.items.every(x => !x.row);
    return '<details class="dq-item"><summary><span class="rank-name">' + esc(i.label) +
      ' <span class="rank-sub">' + esc(i.sheet) + '</span></span><span class="rank-value warn">' + fmtNum(i.n) + '</span></summary>' +
      (noRows ? '<p class="muted">أرقام الأسطر تظهر بعد تحديث Code.gs ثم الضغط على ⟳.</p>' : '') +
      '<div class="table-wrap"><table class="dq-table"><thead><tr><th>السطر</th><th>التاريخ</th><th>الزبون</th><th>تفصيل</th></tr></thead><tbody>' +
      shown.map(x => '<tr><td>' + (x.row || '—') + '</td><td>' + (x.date ? esc(fmtDate(x.date)) : '—') + '</td><td>' +
        (x.name ? esc(x.name) : '<span class="muted">بلا اسم</span>') + (x.code ? ' <span class="rank-sub">' + esc(x.code) + '</span>' : '') +
        '</td><td>' + esc(x.info || '') + '</td></tr>').join('') +
      '</tbody></table></div>' +
      (i.n > LIMIT ? '<p class="muted">يُعرض أول ' + LIMIT + ' سطرًا من ' + fmtNum(i.n) + '.</p>' : '') +
      '</details>';
  }).join('') + '</div>';
}

function clientItem(code, name, region, valueLabel, warn) {
  return '<button class="ranked-item clickable" data-client="' + esc(code) + '"><span class="rank-name">' + esc(name) +
    ' <span class="rank-sub">' + esc(region || '') + '</span></span><span class="rank-value' + (warn ? ' warn' : '') + '">' + valueLabel + '</span></button>';
}

// ============================================================
// نظرة عامة
// ============================================================
let OV_SORT = { key: 'rev', dir: -1 };

function renderOverview() {
  const now = new Date(), curYm = ymOf(now), lastYm = curYm - 1, dd = now.getDate();
  const hasSel = S.regions.size > 0;
  const rp = hasSel ? (r => S.regions.has(r)) : (() => true);
  const clients = DATA.clients.filter(c => rp(c.region));
  const ninety = new Date(now.getTime() - 90 * 86400000);
  const active = clients.filter(c => c.lastSale && c.lastSale >= ninety).length;

  const ships = DATA.ships.filter(r => rp(r.region));
  const pays = DATA.pays.filter(r => rp(r.region));
  const vis = DATA.visits.filter(r => rp(r.region));
  const inThis = r => r.ym === curYm;
  const inLast = r => r.ym === lastYm && r.day <= dd;

  const shipsThis = ships.filter(inThis), shipsLast = ships.filter(inLast);
  const colis = shipsThis.reduce((a, r) => a + r.colis, 0);
  const unconf = shipsThis.filter(r => r.hasCall && !r.confirmed);
  const revThis = pays.filter(inThis).reduce((a, r) => a + r.amount, 0);
  const revLast = pays.filter(inLast).reduce((a, r) => a + r.amount, 0);
  const visThis = vis.filter(inThis).length, visLast = vis.filter(inLast).length;

  // ---- الديون (CREANCE كما في الشيت) ----
  const debtByRegion = {};
  let debtScope = 0, debtors = 0;
  DATA.clients.forEach(c => {
    const b = DATA.bal[c.code];
    if (!b || !(b.cr > 0)) return;
    debtByRegion[c.region] = (debtByRegion[c.region] || 0) + b.cr;
    if (rp(c.region)) { debtScope += b.cr; debtors++; }
  });
  const debts = Object.keys(debtByRegion).map(r => ({ name: r, value: debtByRegion[r] })).sort((a, b) => b.value - a.value);

  // ---- جدول مقارنة المناطق (كل المناطق دائمًا) ----
  const lastVisThisMonth = {};
  DATA.visits.forEach(v => {
    if (v.ym !== curYm || !v.code || !v.date) return;
    const p = lastVisThisMonth[v.code];
    if (!p || v.ts > p.ts) lastVisThisMonth[v.code] = { ts: v.ts, status: v.status };
  });
  const T = {};
  const row = r => T[r] || (T[r] = { region: r, clients: 0, ships: 0, rev: 0, debt: 0, done: 0 });
  DATA.regions.forEach(r => row(r));
  DATA.clients.forEach(c => {
    const o = row(c.region); o.clients++;
    const st = lastVisThisMonth[c.code]; if (st && st.status === 'done') o.done++;
    const b = DATA.bal[c.code]; if (b && b.cr > 0) o.debt += b.cr;
  });
  DATA.ships.forEach(r => { if (r.ym === curYm) row(r.region).ships++; });
  DATA.pays.forEach(r => { if (r.ym === curYm) row(r.region).rev += r.amount; });
  const trows = Object.keys(T).map(k => ({ ...T[k], vpct: T[k].clients ? Math.round(T[k].done / T[k].clients * 100) : 0 }));
  trows.sort((a, b) => OV_SORT.dir * (a[OV_SORT.key] - b[OV_SORT.key]) || a.region.localeCompare(b.region, 'ar'));
  const tint = (key, higherBetter) => {
    const real = trows.filter(r => r.clients > 0);   // صفوف بلا زبائن (شحنات بلا منطقة) لا تدخل في التلوين
    if (real.length < 3) return {};
    const vals = real.map(r => r[key]);
    const mx = Math.max(...vals), mn = Math.min(...vals);
    if (mx === mn) return {};
    return { best: higherBetter ? mx : mn, worst: higherBetter ? mn : mx };
  };
  const tints = { ships: tint('ships', true), rev: tint('rev', true), debt: tint('debt', false), vpct: tint('vpct', true) };
  const cell = (r, key, text) => {
    const t = tints[key];
    const cls = r.clients > 0 && t && t.best !== undefined ? (r[key] === t.best ? ' best' : (r[key] === t.worst ? ' worst' : '')) : '';
    return '<td class="num' + cls + '">' + text + '</td>';
  };
  const th = (key, label) => '<th data-k="' + key + '" class="sortable' + (OV_SORT.key === key ? ' on' : '') + '">' + label +
    (OV_SORT.key === key ? (OV_SORT.dir < 0 ? ' ▼' : ' ▲') : '') + '</th>';
  const tot = trows.reduce((a, r) => ({ clients: a.clients + r.clients, ships: a.ships + r.ships, rev: a.rev + r.rev, debt: a.debt + r.debt, done: a.done + r.done }),
    { clients: 0, ships: 0, rev: 0, debt: 0, done: 0 });

  // ---- اتجاه 6 أشهر ----
  const yms = last6Yms();
  const cnt = {}, rev = {};
  ships.forEach(r => { if (r.ym >= yms[0]) cnt[r.ym] = (cnt[r.ym] || 0) + 1; });
  pays.forEach(r => { if (r.ym >= yms[0]) rev[r.ym] = (rev[r.ym] || 0) + r.amount; });

  // ---- ماذا أفعل اليوم ----
  const stopped = clients.map(c => {
    const ls = c.lastSale || maxDate(DATA.shipsBy[c.code], 'date');
    return { c, days: ls ? daysBetween(now, ls) : null };
  }).filter(x => x.days !== null && x.days > 60).sort((a, b) => b.days - a.days).slice(0, 5);
  const topDebt = clients.map(c => ({ c, cr: (DATA.bal[c.code] || {}).cr || 0 })).filter(x => x.cr > 0).sort((a, b) => b.cr - a.cr).slice(0, 5);
  const unconfBy = {};
  unconf.forEach(r => { if (r.code) unconfBy[r.code] = (unconfBy[r.code] || 0) + 1; });
  const unconfList = Object.keys(unconfBy).map(k => ({ code: k, n: unconfBy[k] })).sort((a, b) => b.n - a.n).slice(0, 5);
  const noVisit = clients.map(c => {
    const lv = lastVisitDate(c.code);
    return { c, days: lv ? daysBetween(now, lv) : null };
  }).filter(x => x.days === null || x.days > 30).sort((a, b) => (b.days == null ? 9999 : b.days) - (a.days == null ? 9999 : a.days)).slice(0, 5);

  const act = (id, title, items, empty) => '<div class="action-card" id="' + id + '"><h4>' + title + '</h4>' +
    (items.length ? '<div class="ranked-list">' + items.join('') + '</div>' : '<p class="muted">' + empty + '</p>') + '</div>';

  const tg = getTargets();
  const showTarget = !hasSel;

  let html = '<p class="period-note">📍 ' + esc(regionLabel()) + ' &nbsp;·&nbsp; 📅 هذا الشهر (حتى اليوم ' + dd + ')</p>';

  // 1) ثلاثة مؤشرات رئيسية
  html += '<div class="hero-grid">' +
    heroCard('💰', '#f50057', 'مداخيل الشهر (دج)', fmtNum(revThis), changeHtml(revThis, revLast, dd), showTarget ? tg.revenue : 0, revThis) +
    heroCard('🚚', '#7b4dff', 'الشحنات هذا الشهر', fmtNum(shipsThis.length), changeHtml(shipsThis.length, shipsLast.length, dd), showTarget ? tg.shipments : 0, shipsThis.length) +
    heroCard('💸', '#ffc107', 'إجمالي الديون (CREANCE)', fmtNum(debtScope) + ' دج', '<div class="kpi-sub flat">' + fmtNum(debtors) + ' زبون مدين — كما في عمود CREANCE</div>', 0, 0) +
    '</div>';

  // 5) مؤشرات ثانوية مصغّرة
  html += '<div class="mini-strip">' +
    '<div class="mini"><b>' + fmtNum(clients.length) + '</b><span>👥 زبون</span></div>' +
    '<div class="mini"><b>' + fmtNum(active) + '</b><span>✅ نشط (90 يوم)</span></div>' +
    '<div class="mini"><b>' + fmtNum(colis) + '</b><span>📦 كولي هذا الشهر</span></div>' +
    '<div class="mini"><b>' + fmtNum(visThis) + '</b><span>📍 زيارة ' + (visLast ? (visThis >= visLast ? '▲' : '▼') : '') + '</span></div>' +
    '<a class="mini warnmini" href="#actUnconf"><b>' + fmtNum(unconf.length) + '</b><span>⚠️ دون تأكيد</span></a>' +
    '</div>';

  html += '<details class="targets"><summary>🎯 الأهداف الشهرية (اختيارية — تظهر كشريط تقدّم عند عدم تصفية المنطقة)</summary>' +
    '<div class="targets-form"><label>مداخيل (دج)<input id="tgRev" type="number" min="0" value="' + (tg.revenue || '') + '"></label>' +
    '<label>شحنات<input id="tgShip" type="number" min="0" value="' + (tg.shipments || '') + '"></label>' +
    '<button id="tgSave" class="fb-chip">حفظ</button></div></details>';

  // 2) منحنى واحد للشحنات والمداخيل
  html += chartBox('ovTrend', 240, '📈 الشحنات والمداخيل — آخر 6 أشهر');

  // 3) جدول المناطق + مخطط الديون
  html += '<h3 class="section-title">🗺️ مقارنة المناطق هذا الشهر <span class="hint-text">(اضغط على صف لتصفية الصفحات بمنطقته — الأخضر الأفضل والأحمر الأسوأ)</span></h3>';
  html += '<div class="table-wrap"><table class="region-table"><thead><tr><th>المنطقة</th>' +
    th('clients', 'زبائن') + th('ships', 'شحنات') + th('rev', 'مداخيل') + th('debt', 'الدين') + th('vpct', 'نجاح الزيارات') +
    '</tr></thead><tbody>' + trows.map(r =>
      '<tr class="' + (S.regions.has(r.region) ? 'sel' : '') + '" data-region="' + esc(r.region) + '"><td class="rn">' + esc(r.region) + '</td>' +
      '<td class="num">' + fmtNum(r.clients) + '</td>' + cell(r, 'ships', fmtNum(r.ships)) + cell(r, 'rev', fmtNum(r.rev)) +
      cell(r, 'debt', fmtNum(r.debt)) + cell(r, 'vpct', r.vpct + '%') + '</tr>').join('') +
    '</tbody><tfoot><tr><td class="rn">الإجمالي</td><td class="num">' + fmtNum(tot.clients) + '</td><td class="num">' + fmtNum(tot.ships) +
    '</td><td class="num">' + fmtNum(tot.rev) + '</td><td class="num">' + fmtNum(tot.debt) + '</td><td class="num">' +
    (tot.clients ? Math.round(tot.done / tot.clients * 100) : 0) + '%</td></tr></tfoot></table></div>';

  html += '<h3 class="section-title">💸 الديون حسب المنطقة <span class="hint-text">(اضغط على منطقة أو أكثر للتصفية)</span>' +
    (hasSel ? ' <button id="clearRegions" class="fb-chip">✖ مسح التحديد</button>' : '') + '</h3>';
  html += debts.length ? '<div class="chart-card"><div class="chart" id="ovDebts" style="height:' + barHeight(debts.length) + 'px"></div></div>'
    : '<p class="muted">لا توجد ديون مسجَّلة حاليًا 👍</p>';

  // 4) ماذا أفعل اليوم
  html += '<h3 class="section-title">✅ ماذا أفعل اليوم <span class="hint-text">(اضغط على اسم لفتح بطاقة الزبون)</span></h3>';
  html += '<div class="actions-grid">' +
    act('actStopped', '🚨 توقفوا عن الشراء (أكثر من 60 يومًا)', stopped.map(x => clientItem(x.c.code, x.c.name, x.c.region, x.days + ' يوم', true)), 'لا يوجد 👍') +
    act('actDebt', '💸 أكبر الديون', topDebt.map(x => clientItem(x.c.code, x.c.name, x.c.region, fmtNum(x.cr) + ' دج', false)), 'لا توجد ديون') +
    act('actUnconf', '📞 شحنات هذا الشهر دون تأكيد', unconfList.map(x => { const c = DATA.clientByCode[x.code]; return clientItem(x.code, c ? c.name : x.code, c ? c.region : '', x.n + ' شحنة', true); }), 'كل الشحنات مؤكَّدة 👍') +
    act('actVisit', '📍 بلا زيارة منذ أكثر من 30 يومًا', noVisit.map(x => clientItem(x.c.code, x.c.name, x.c.region, x.days === null ? 'لم تُزر إطلاقًا' : x.days + ' يوم', true)), 'كل الزبائن تمت زيارتهم مؤخرًا 👍') +
    '</div>';

  html += '<details class="dq"><summary>🧪 جودة البيانات (' + dataQualityIssues().length + ' ملاحظة)</summary>' + dataQualityHtml() + '</details>';
  html += '<p class="last-update">' + lastUpdateText() + ' — المقارنات لأول ' + dd + ' يوم من كل شهر (مقارنة عادلة)</p>';

  $('content-overview').innerHTML = html;

  // ---- ربط الرسوم والأحداث ----
  mount('ovTrend', trendOption(yms.map(ymLabel), [
    { name: 'الشحنات', color: '#7b4dff', data: yms.map(y => cnt[y] || 0), axis: 0 },
    { name: 'المداخيل (دج)', color: '#f50057', data: yms.map(y => rev[y] || 0), axis: 1 }
  ]), null, null);
  if (debts.length) mount('ovDebts', barOption(debts, { selected: S.regions, color: '#ffc107', fmt: v => fmtNum(v) + ' دج' }),
    p => { toggleIn(S.regions, p.name); refreshAll(); });

  const root = $('content-overview');
  root.querySelectorAll('.region-table tbody tr').forEach(tr =>
    tr.addEventListener('click', () => { toggleIn(S.regions, tr.dataset.region); refreshAll(); }));
  root.querySelectorAll('.region-table th.sortable').forEach(h => h.addEventListener('click', () => {
    OV_SORT = { key: h.dataset.k, dir: OV_SORT.key === h.dataset.k ? -OV_SORT.dir : -1 };
    renderCurrent();
  }));
  const clr = $('clearRegions'); if (clr) clr.addEventListener('click', () => { S.regions.clear(); refreshAll(); });
  $('tgSave').addEventListener('click', () => {
    setTargets({ revenue: +$('tgRev').value || 0, shipments: +$('tgShip').value || 0 });
    renderCurrent();
  });
  bindClientLinks(root);
}

// ============================================================
// الشحنات
// ============================================================
function renderShipments() {
  const c = CF.ships.conf.value();
  const yms = last6Yms(), tm = {};
  CF.ships.trend.all().forEach(g => { tm[g.key] = g.value; });
  const wil = topOf(CF.ships.byWilaya, v => v, 8);
  const trn = topOf(CF.ships.byTransport, v => v, 8);
  const reg = topOf(CF.ships.byRegion, v => v, 10);
  const pct = c.total ? Math.round(c.yes / c.total * 100) : null;
  const confSeries = yms.map(y => (tm[y] && tm[y].tot) ? Math.round(tm[y].yes / tm[y].tot * 100) : null);
  const heat = heatData(DATA.ships, () => 1);

  let html = periodNote();
  html += statRow([{ label: 'شحنات الفترة', value: fmtNum(c.n) }, { label: 'كوليات الفترة', value: fmtNum(c.k) },
    { label: 'متوسط الكوليات للشحنة', value: c.n ? (c.k / c.n).toFixed(1) : '—' }]);

  const trendBox = chartBox('shTrend', 220, 'الشحنات آخر 6 أشهر <span class="hint-text">(اضغط على شهر لاختياره)</span>');
  const confBox = '<h3 class="section-title">نسبة تأكيد الزبائن بالشحنة</h3><div class="chart-card conf-card">' +
    (pct === null ? emptyNote('لا توجد شحنات مسجَّلة فيها Call Phone')
      : '<div class="big-number" style="color:' + (pct >= 70 ? GOOD : (pct >= 40 ? '#ffc107' : BAD)) + '">' + pct + '%</div>' +
        '<div class="donut-caption">' + fmtNum(c.yes) + ' مؤكَّدة من ' + fmtNum(c.total) + ' شحنة مسجَّلة (Call Phone) في الفترة</div>' +
        '<div class="chart" id="shConf" style="height:130px"></div>') + '</div>';
  html += grid2(trendBox, confBox);

  html += grid2(
    wil.length ? chartBox('shWil', barHeight(wil.length), 'أكثر الولايات طلبًا') : '<h3 class="section-title">أكثر الولايات طلبًا</h3>' + emptyNote(),
    trn.length ? chartBox('shTrn', barHeight(trn.length), 'أكثر مؤسسات النقل استعمالًا') : '<h3 class="section-title">أكثر مؤسسات النقل استعمالًا</h3>' + emptyNote());
  html += grid2(
    reg.length ? chartBox('shReg', barHeight(reg.length), 'توزيع الشحنات حسب المناطق') : '<h3 class="section-title">توزيع الشحنات حسب المناطق</h3>' + emptyNote(),
    chartBox('shHeat', Math.max(180, heat.regs.length * 36 + 40), '🔥 الشحنات: منطقة × شهر <span class="hint-text">(اضغط على خلية)</span>'));
  $('content-shipments').innerHTML = html;

  mount('shTrend', trendOption(yms.map(ymLabel), [{ name: 'شحنات', color: '#7b4dff', data: yms.map(y => tm[y] ? tm[y].n : 0) }]), null, trendClickHandler(yms));
  if (pct !== null) mount('shConf', trendOption(yms.map(ymLabel), [{ name: 'نسبة التأكيد', color: '#ffc107', data: confSeries }], { pct: true, yMax: 100, fmt: v => v + '%' }));
  if (wil.length) mount('shWil', barOption(wil, { selected: S.wilaya }), p => { toggleIn(S.wilaya, p.name); refreshAll(); });
  if (trn.length) mount('shTrn', barOption(trn, { selected: S.transport }), p => { toggleIn(S.transport, p.name); refreshAll(); });
  if (reg.length) mount('shReg', barOption(reg, { selected: S.regions }), p => { toggleIn(S.regions, p.name); refreshAll(); });
  mount('shHeat', heatmapOption(heat.regs, heat.yms.map(ymLabel), heat.matrix, heat.max, fmtNum, S.regions), heatClickHandler(heat));
}

// ============================================================
// المداخيل
// ============================================================
function renderRevenue() {
  const all = CF.pays.all.value();
  const yms = last6Yms(), tm = {};
  CF.pays.trend.all().forEach(g => { tm[g.key] = g.value; });
  const reg = topOf(CF.pays.byRegion, v => v.s, 10);
  const rep = topOf(CF.pays.byRep, v => v.s, 10);
  const clientsInPeriod = CF.pays.byClient.all().filter(g => g.value.n > 0 && g.key).sort((a, b) => b.value.s - a.value.s);
  const topClients = clientsInPeriod.slice(0, 10);
  const top10Sum = topClients.reduce((a, g) => a + g.value.s, 0);
  const conc = all.s ? Math.round(top10Sum / all.s * 100) : null;
  const heat = heatData(DATA.pays, r => r.amount);

  let html = periodNote();
  html += statRow([
    { label: 'مجموع الفترة', value: fmtNum(all.s) + ' دج' },
    { label: 'عدد الدفعات', value: fmtNum(all.n) },
    { label: 'متوسط الدفعة', value: fmtNum(all.n ? all.s / all.n : 0) + ' دج' },
    { label: 'تركّز أكبر 10 زبائن', value: conc === null ? '—' : conc + '%', cls: conc !== null && conc >= 70 ? 'warn' : '' }
  ]);
  if (conc !== null && conc >= 70) html += '<p class="warn-note">⚠️ أكبر 10 زبائن يأتون بـ ' + conc + '% من مداخيل الفترة — اعتماد مرتفع على عدد قليل من الزبائن.</p>';

  html += grid2(
    chartBox('rvTrend', 220, 'المداخيل آخر 6 أشهر (دج) <span class="hint-text">(اضغط على شهر لاختياره)</span>'),
    chartBox('rvHeat', Math.max(180, heat.regs.length * 36 + 40), '🔥 المداخيل: منطقة × شهر <span class="hint-text">(اضغط على خلية)</span>'));
  html += grid2(
    reg.length ? chartBox('rvReg', barHeight(reg.length), 'المداخيل حسب المنطقة') : '<h3 class="section-title">المداخيل حسب المنطقة</h3>' + emptyNote(),
    rep.length ? chartBox('rvRep', barHeight(rep.length), 'المداخيل حسب المندوب') : '<h3 class="section-title">المداخيل حسب المندوب</h3>' + emptyNote());

  html += '<h3 class="section-title">أكبر 10 زبائن مساهمة</h3>';
  html += topClients.length
    ? '<div class="ranked-list two-col">' + topClients.map((g, i) => {
        const cl = DATA.clientByCode[g.key];
        return '<button class="ranked-item clickable" data-client="' + esc(g.key) + '"><span class="rank">' + (i + 1) + '</span>' +
          '<span class="rank-name">' + esc(cl ? cl.name : g.key) + ' <span class="rank-sub">(' + g.value.n + ' دفعة — ' +
          (all.s ? Math.round(g.value.s / all.s * 100) : 0) + '%)</span></span>' +
          '<span class="rank-value">' + fmtNum(g.value.s) + ' دج</span></button>';
      }).join('') + '</div>'
    : emptyNote('لا توجد بيانات لهذه الفلاتر');
  $('content-revenue').innerHTML = html;

  mount('rvTrend', trendOption(yms.map(ymLabel), [{ name: 'مداخيل', color: '#f50057', data: yms.map(y => tm[y] ? tm[y].s : 0) }]), null, trendClickHandler(yms));
  mount('rvHeat', heatmapOption(heat.regs, heat.yms.map(ymLabel), heat.matrix, heat.max, v => fmtNum(v) + ' دج', S.regions), heatClickHandler(heat));
  if (reg.length) mount('rvReg', barOption(reg, { selected: S.regions, fmt: v => fmtNum(v) + ' دج' }), p => { toggleIn(S.regions, p.name); refreshAll(); });
  if (rep.length) mount('rvRep', barOption(rep, { selected: S.rep, fmt: v => fmtNum(v) + ' دج' }), p => { toggleIn(S.rep, p.name); refreshAll(); });
  bindClientLinks($('content-revenue'));
}

// ============================================================
// الزيارات
// ============================================================
const VISIT_DEFS = [
  { key: 'done', label: 'تمت', color: '#35e2a4' },
  { key: 'notDone', label: 'لم تتم', color: '#ffc107' },
  { key: 'notFound', label: 'لم يوجد', color: '#ff5c72' },
  { key: 'never', label: 'لم يُزَر خلال الفترة', color: '#8a5c72' }
];

/** آخر حالة لكل زبون ضمن الفترة المختارة (مع إلغاء فلتر المنطقة مؤقتًا ليظهر كل المناطق في الرسم) */
function latestVisitStatus() {
  const V = CF.visits;
  V.region.filterAll();
  const rows = V.cf.allFiltered();
  const last = {};
  rows.forEach(r => {
    if (!r.code || !r.date) return;
    const p = last[r.code];
    if (!p || r.ts > p.ts) last[r.code] = { ts: r.ts, status: r.status };
  });
  setDim(V.region, S.regions);
  return last;
}

function renderVisits() {
  const last = latestVisitStatus();
  const byRegion = {};
  DATA.clients.forEach(c => {
    const o = byRegion[c.region] || (byRegion[c.region] = { region: c.region, total: 0, done: 0, notDone: 0, notFound: 0, never: 0 });
    o.total++;
    const st = last[c.code];
    if (!st) o.never++; else o[st.status]++;
  });
  // مرتّبة بنسبة النجاح (الأفضل أولًا)
  const rows = Object.keys(byRegion).map(k => byRegion[k])
    .sort((a, b) => (b.total ? b.done / b.total : 0) - (a.total ? a.done / a.total : 0));
  const scope = rows.filter(r => !S.regions.size || S.regions.has(r.region));
  const totalAll = scope.reduce((a, r) => a + r.total, 0);
  const totalDone = scope.reduce((a, r) => a + r.done, 0);
  const pct = totalAll ? Math.round(totalDone / totalAll * 100) : 0;
  const nVisits = CF.visits.cf.allFiltered().length;

  const now = new Date();
  const follow = DATA.clients.filter(c => !S.regions.size || S.regions.has(c.region)).map(c => {
    const lv = lastVisitDate(c.code);
    return { code: c.code, name: c.name, region: c.region, days: lv ? daysBetween(now, lv) : null };
  }).filter(x => x.days === null || x.days > 30)
    .sort((a, b) => (b.days == null ? 9999 : b.days) - (a.days == null ? 9999 : a.days)).slice(0, 20);

  let html = periodNote();
  html += '<div class="hero-grid two">' +
    '<div class="hero-card" style="--kpi-accent:#c2185b"><div class="kpi-icon" style="background:#c2185b">📍</div><div class="hero-body">' +
    '<div class="kpi-label">نسبة نجاح الزيارات (زبائن حالتهم "تمت" خلال الفترة)</div>' +
    '<div class="hero-value" style="color:' + (pct >= 70 ? GOOD : (pct >= 40 ? '#ffc107' : BAD)) + '">' + pct + '%</div>' +
    '<div class="kpi-formula">' + fmtNum(totalDone) + ' من ' + fmtNum(totalAll) + ' زبون</div></div></div>' +
    '<div class="hero-card" style="--kpi-accent:#7b4dff"><div class="kpi-icon" style="background:#7b4dff">🧾</div><div class="hero-body">' +
    '<div class="kpi-label">زيارات الفترة</div><div class="hero-value">' + fmtNum(nVisits) + '</div></div></div></div>';

  html += chartBox('vsReg', Math.max(170, rows.length * 46 + 50), 'حالة كل زبون حسب المنطقة (نسبة 100% لكل منطقة، الأفضل أولًا) <span class="hint-text">(اضغط على منطقة لتصفية بها)</span>');
  html += '<h3 class="section-title">زبائن يحتاجون متابعة (أكثر من 30 يومًا بلا زيارة)</h3>';
  html += follow.length
    ? '<div class="ranked-list two-col">' + follow.map(c =>
        clientItem(c.code, c.name, c.region, c.days === null ? 'لم تُزر إطلاقًا' : c.days + ' يوم', true)).join('') + '</div>'
    : '<p class="muted">لا يوجد — كل الزبائن تمت زيارتهم مؤخرًا 👍</p>';
  $('content-visits').innerHTML = html;

  mount('vsReg', stackedPctOption(rows, VISIT_DEFS, S.regions), p => { toggleIn(S.regions, p.name); refreshAll(); });
  bindClientLinks($('content-visits'));
}

/** أي عنصر فيه data-client يفتح بطاقة الزبون */
function bindClientLinks(root) {
  root.querySelectorAll('[data-client]').forEach(el =>
    el.addEventListener('click', () => openClient(el.dataset.client)));
}
