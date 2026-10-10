'use strict';
/* ============================================================
   pages.js — رسم الصفحات: نظرة عامة، شحنات، مداخيل، زيارات
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

/** اضغط على نقطة في المنحنى = اختر ذلك الشهر والسنة */
function trendClickHandler(yms) {
  return idx => {
    const ym = yms[idx];
    if (ym === undefined) return;
    S.months = new Set([(ym % 12) + 1]);
    S.years = new Set([Math.floor(ym / 12)]);
    refreshAll();
  };
}

// ---------- بطاقة KPI ----------
function kpiCard(icon, gradient, accent, label, value, subHtml, formula, wide) {
  return '<div class="kpi-card' + (wide ? ' wide' : '') + '" style="--kpi-accent:' + accent + '">' +
    '<div class="kpi-icon" style="background:' + gradient + '">' + icon + '</div>' +
    '<div class="kpi-label">' + label + '</div>' +
    '<div class="kpi-value">' + value + '</div>' + (subHtml || '') +
    (formula ? '<div class="kpi-formula">' + formula + '</div>' : '') + '</div>';
}
function changeHtml(cur, prev, days) {
  if (!prev) return '<div class="kpi-sub flat">لا توجد بيانات للمقارنة</div>';
  const pct = ((cur - prev) / prev) * 100;
  const cls = pct > 0 ? 'up' : (pct < 0 ? 'down' : 'flat');
  const arrow = pct > 0 ? '▲' : (pct < 0 ? '▼' : '—');
  return '<div class="kpi-sub ' + cls + '">' + arrow + ' ' + Math.abs(pct).toFixed(0) + '% مقارنة بأول ' + days + ' يوم من الشهر الماضي</div>';
}

// ============================================================
// نظرة عامة (تعتمد فلتر المناطق فقط — المؤشرات دائمًا "هذا الشهر")
// ============================================================
function renderOverview() {
  const now = new Date(), curYm = ymOf(now), lastYm = curYm - 1, dd = now.getDate();
  const rp = S.regions.size ? (r => S.regions.has(r)) : (() => true);
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
  const notInformed = shipsThis.filter(r => r.hasCall && !r.confirmed).length;
  const revThis = pays.filter(inThis).reduce((a, r) => a + r.amount, 0);
  const revLast = pays.filter(inLast).reduce((a, r) => a + r.amount, 0);
  const visThis = vis.filter(inThis).length, visLast = vis.filter(inLast).length;

  // ديون كل المناطق (دائمًا الكل ليبقى الاختيار المتعدد ممكنًا)
  const debtMap = {};
  DATA.clients.forEach(c => {
    const b = DATA.bal[c.code];
    if (b && b.cr > 0) debtMap[c.region] = (debtMap[c.region] || 0) + b.cr;
  });
  const debts = Object.keys(debtMap).map(r => ({ region: r, amount: debtMap[r] })).sort((a, b) => b.amount - a.amount);
  const hasSel = S.regions.size > 0;
  const totalDebt = debts.filter(d => !hasSel || S.regions.has(d.region)).reduce((a, d) => a + d.amount, 0);

  // اتجاه 6 أشهر
  const yms = last6Yms();
  const cnt = {}, rev = {};
  ships.forEach(r => { if (r.ym >= yms[0]) cnt[r.ym] = (cnt[r.ym] || 0) + 1; });
  pays.forEach(r => { if (r.ym >= yms[0]) rev[r.ym] = (rev[r.ym] || 0) + r.amount; });

  let html = periodNoteOverview();
  html += '<div class="kpi-grid">' +
    kpiCard('👥', 'linear-gradient(135deg,#c2185b,#ff8fab)', '#c2185b', 'عدد الزبائن', fmtNum(clients.length), '', 'كل صف بكود في CLIENT') +
    kpiCard('✅', 'linear-gradient(135deg,#00bfa5,#64ffda)', '#35e2a4', 'زبائن نشطون', fmtNum(active), '', 'آخر بيع خلال 90 يوم') +
    kpiCard('🚚', 'linear-gradient(135deg,#d500f9,#ff4081)', '#7b4dff', 'الشحنات هذا الشهر', fmtNum(shipsThis.length), changeHtml(shipsThis.length, shipsLast.length, dd), 'عدد صفوف GLOBAL هذا الشهر') +
    kpiCard('📦', 'linear-gradient(135deg,#ffab00,#ffd600)', '#ffc107', 'الكوليات هذا الشهر', fmtNum(colis), '', 'مجموع عمود n colee') +
    kpiCard('💰', 'linear-gradient(135deg,#f50057,#ff8fab)', '#f50057', 'مداخيل الشهر (دج)', fmtNum(revThis), changeHtml(revThis, revLast, dd), 'مجموع المبلغ هذا الشهر', true) +
    kpiCard('📍', 'linear-gradient(135deg,#c2185b,#ffc107)', '#c2185b', 'الزيارات هذا الشهر', fmtNum(visThis), changeHtml(visThis, visLast, dd), 'عدد صفوف CustomerLog هذا الشهر') +
    kpiCard('⚠️', 'linear-gradient(135deg,#e63757,#ff8fab)', '#ff5c72', 'شحنات دون تأكيد', fmtNum(notInformed), '', 'Call Phone غير مؤكَّد') +
    '</div>';

  html += chartBox('ovShips', 200, '🚚 الشحنات — آخر 6 أشهر');
  html += chartBox('ovRev', 200, '💰 المداخيل — آخر 6 أشهر (دج)');

  html += '<h3 class="section-title">💸 ديون الزبائن على الشركة حسب المنطقة <span class="muted hint-text">(اضغط على منطقة أو أكثر لتصفية كل الصفحات)</span></h3>';
  if (!debts.length) {
    html += '<p class="muted">لا توجد ديون مسجَّلة حاليًا 👍</p>';
  } else {
    const colors = ['#c2185b', '#7b4dff', '#ffc107', '#35e2a4', '#ff5c72', '#00bfa5', '#f50057', '#ff8fab'];
    html += '<div class="kpi-grid">' + debts.map((d, i) => {
      const col = colors[i % colors.length], sel = S.regions.has(d.region);
      return '<div class="kpi-card debt-card' + (sel ? ' selected' : '') + '" style="--kpi-accent:' + col + '" data-region="' + esc(d.region) + '">' +
        '<span class="kpi-check">✔️</span>' +
        '<div class="kpi-icon" style="background:linear-gradient(135deg,' + col + ',#ff8fab)">💸</div>' +
        '<div class="kpi-label">' + esc(d.region) + '</div>' +
        '<div class="kpi-value">' + fmtNum(d.amount) + ' دج</div>' +
        '<div class="kpi-formula">مجموع CREANCE لزبائن هذه المنطقة — اضغط للتصفية</div></div>';
    }).join('') +
      '<div class="kpi-card wide total-card' + (hasSel ? ' clearable' : '') + '" id="debtTotal" style="--kpi-accent:#7b4dff">' +
      '<div class="kpi-icon" style="background:linear-gradient(135deg,#c2185b,#7b4dff)">📊</div>' +
      '<div class="kpi-label">' + (hasSel ? 'إجمالي المناطق المحدَّدة' : 'الإجمالي — كل المناطق') + '</div>' +
      '<div class="kpi-value">' + fmtNum(totalDebt) + ' دج</div>' +
      '<div class="kpi-formula">' + (hasSel ? 'اضغط للرجوع لكل المناطق' : 'مجموع كل بطاقات الديون أعلاه') + '</div></div></div>';
  }
  html += '<p class="last-update">' + lastUpdateText() + ' — المقارنات لأول ' + dd + ' يوم من كل شهر (مقارنة عادلة)</p>';

  $('content-overview').innerHTML = html;

  const labels = yms.map(ymLabel);
  mount('ovShips', trendOption(labels, [{ name: 'شحنات', color: '#d500f9', data: yms.map(y => cnt[y] || 0) }]));
  mount('ovRev', trendOption(labels, [{ name: 'مداخيل', color: '#c2185b', data: yms.map(y => rev[y] || 0) }]));

  $('content-overview').querySelectorAll('.debt-card').forEach(el =>
    el.addEventListener('click', () => { toggleIn(S.regions, el.dataset.region); refreshAll(); }));
  const tot = $('debtTotal');
  if (tot && hasSel) tot.addEventListener('click', () => { S.regions.clear(); refreshAll(); });
}
function periodNoteOverview() {
  return '<p class="period-note">📍 ' + esc(regionLabel()) + '</p>';
}
function lastUpdateText() {
  return 'آخر تحديث: ' + (DATA.generatedAt ? DATA.generatedAt.toLocaleString('ar-DZ') : '—');
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

  let html = periodNote();
  html += statRow([{ label: 'شحنات الفترة', value: fmtNum(c.n) }, { label: 'كوليات الفترة', value: fmtNum(c.k) }]);
  html += chartBox('shTrend', 210, 'الشحنات آخر 6 أشهر <span class="hint-text">(اضغط على نقطة لاختيار شهرها)</span>');
  html += '<h3 class="section-title">نسبة تأكيد الزبائن بالشحنة</h3>' +
    (pct === null ? emptyNote('لا توجد شحنات مسجَّلة فيها Call Phone')
      : '<div class="chart-card donut-card"><div class="chart" id="shConf" style="height:150px;width:150px"></div>' +
        '<div class="donut-caption">من أصل ' + fmtNum(c.total) + ' شحنة مسجَّلة (Call Phone) — ' + fmtNum(c.yes) + ' مؤكَّدة</div></div>');
  html += wil.length ? chartBox('shWil', barHeight(wil.length), 'أكثر الولايات طلبًا') : '<h3 class="section-title">أكثر الولايات طلبًا</h3>' + emptyNote();
  html += trn.length ? chartBox('shTrn', barHeight(trn.length), 'أكثر مؤسسات النقل استعمالًا') : '<h3 class="section-title">أكثر مؤسسات النقل استعمالًا</h3>' + emptyNote();
  html += reg.length ? chartBox('shReg', barHeight(reg.length), 'توزيع الشحنات حسب المناطق') : '<h3 class="section-title">توزيع الشحنات حسب المناطق</h3>' + emptyNote();
  $('content-shipments').innerHTML = html;

  mount('shTrend', trendOption(yms.map(ymLabel), [{ name: 'شحنات', color: '#d500f9', data: yms.map(y => tm[y] ? tm[y].n : 0) }]), null, trendClickHandler(yms));
  if (pct !== null) mount('shConf', donutOption(pct, '#ffc107'));
  if (wil.length) mount('shWil', barOption(wil, { selected: S.wilaya }), p => { toggleIn(S.wilaya, p.name); refreshAll(); });
  if (trn.length) mount('shTrn', barOption(trn, { selected: S.transport }), p => { toggleIn(S.transport, p.name); refreshAll(); });
  if (reg.length) mount('shReg', barOption(reg, { selected: S.regions }), p => { toggleIn(S.regions, p.name); refreshAll(); });
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
  const topClients = CF.pays.byClient.all().filter(g => g.value.n > 0 && g.key)
    .sort((a, b) => b.value.s - a.value.s).slice(0, 10);

  let html = periodNote();
  html += statRow([
    { label: 'مجموع الفترة', value: fmtNum(all.s) + ' دج' },
    { label: 'عدد الدفعات', value: fmtNum(all.n) },
    { label: 'متوسط الدفعة', value: fmtNum(all.n ? all.s / all.n : 0) + ' دج' }
  ]);
  html += chartBox('rvTrend', 210, 'المداخيل آخر 6 أشهر (دج) <span class="hint-text">(اضغط على نقطة لاختيار شهرها)</span>');
  html += reg.length ? chartBox('rvReg', barHeight(reg.length), 'المداخيل حسب المنطقة') : '<h3 class="section-title">المداخيل حسب المنطقة</h3>' + emptyNote();
  html += rep.length ? chartBox('rvRep', barHeight(rep.length), 'المداخيل حسب المندوب') : '<h3 class="section-title">المداخيل حسب المندوب</h3>' + emptyNote();
  html += '<h3 class="section-title">أكبر 10 زبائن مساهمة</h3>';
  html += topClients.length
    ? '<div class="ranked-list">' + topClients.map((g, i) => {
        const cl = DATA.clientByCode[g.key];
        return '<button class="ranked-item clickable" data-client="' + esc(g.key) + '"><span class="rank">' + (i + 1) + '</span>' +
          '<span class="rank-name">' + esc(cl ? cl.name : g.key) + ' <span class="rank-sub">(' + g.value.n + ' دفعة)</span></span>' +
          '<span class="rank-value">' + fmtNum(g.value.s) + ' دج</span></button>';
      }).join('') + '</div>'
    : emptyNote('لا توجد بيانات لهذه الفلاتر');
  $('content-revenue').innerHTML = html;

  mount('rvTrend', trendOption(yms.map(ymLabel), [{ name: 'مداخيل', color: '#c2185b', data: yms.map(y => tm[y] ? tm[y].s : 0) }]), null, trendClickHandler(yms));
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
  const rows = Object.keys(byRegion).map(k => byRegion[k]).sort((a, b) => b.total - a.total);
  const scope = rows.filter(r => !S.regions.size || S.regions.has(r.region));
  const totalAll = scope.reduce((a, r) => a + r.total, 0);
  const totalDone = scope.reduce((a, r) => a + r.done, 0);
  const pct = totalAll ? Math.round(totalDone / totalAll * 100) : 0;
  const nVisits = CF.visits.cf.allFiltered().length;

  // زبائن يحتاجون متابعة (آخر زيارة على الإطلاق > 30 يومًا)
  const now = new Date();
  const follow = DATA.clients.filter(c => !S.regions.size || S.regions.has(c.region)).map(c => {
    const vs = DATA.visitsBy[c.code] || [];
    let lastTs = 0;
    vs.forEach(v => { if (v.ts > lastTs) lastTs = v.ts; });
    return { code: c.code, name: c.name, region: c.region, days: lastTs ? daysBetween(now, new Date(lastTs)) : null };
  }).filter(x => x.days === null || x.days > 30)
    .sort((a, b) => (b.days == null ? 9999 : b.days) - (a.days == null ? 9999 : a.days)).slice(0, 20);

  let html = periodNote();
  html += statRow([{ label: 'زيارات الفترة', value: fmtNum(nVisits) }, { label: 'زبائن ضمن النطاق', value: fmtNum(totalAll) }]);
  html += '<h3 class="section-title">نسبة نجاح الزيارات إجمالًا</h3>' +
    '<div class="chart-card donut-card"><div class="chart" id="vsDonut" style="height:150px;width:150px"></div>' +
    '<div class="donut-caption">' + fmtNum(totalDone) + ' من ' + fmtNum(totalAll) + ' زبون حالتهم "تمت" خلال الفترة المختارة</div></div>';
  html += chartBox('vsReg', Math.max(160, rows.length * 44 + 50), 'حالة كل زبون حسب المنطقة خلال الفترة <span class="hint-text">(اضغط على منطقة لتصفية بها)</span>');
  html += '<h3 class="section-title">زبائن يحتاجون متابعة (أكثر من 30 يومًا بلا زيارة)</h3>';
  html += follow.length
    ? '<div class="ranked-list">' + follow.map(c =>
        '<button class="ranked-item clickable" data-client="' + esc(c.code) + '"><span class="rank-name">' + esc(c.name) +
        ' <span class="rank-sub">(' + esc(c.region) + ')</span></span><span class="rank-value warn">' +
        (c.days === null ? 'لم تُزر إطلاقًا' : c.days + ' يوم') + '</span></button>').join('') + '</div>'
    : '<p class="muted">لا يوجد — كل الزبائن تمت زيارتهم مؤخرًا 👍</p>';
  $('content-visits').innerHTML = html;

  mount('vsDonut', donutOption(pct, '#c2185b'));
  mount('vsReg', stackedOption(rows, VISIT_DEFS, S.regions), p => { toggleIn(S.regions, p.name); refreshAll(); });
  bindClientLinks($('content-visits'));
}

/** أي عنصر فيه data-client يفتح بطاقة الزبون */
function bindClientLinks(root) {
  root.querySelectorAll('[data-client]').forEach(el =>
    el.addEventListener('click', () => openClient(el.dataset.client)));
}
