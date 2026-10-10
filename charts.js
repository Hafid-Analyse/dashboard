'use strict';
/* ============================================================
   charts.js — محرك Crossfilter + أدوات ECharts
   ============================================================ */

const PALETTE = ['#c2185b', '#7b4dff', '#35e2a4', '#ffc107', '#ff5c72', '#ff8fab', '#00bfa5', '#f50057'];

// ---------- Crossfilter: ثلاث مجموعات بيانات، كل واحدة ببُعد المنطقة + بُعد الفترة (سنة*12+شهر) ----------
const CF = {};

function buildCrossfilter() {
  const mk = (rows, extra) => {
    const cf = crossfilter(rows);
    const o = { cf, region: cf.dimension(r => r.region), ym: cf.dimension(r => r.ym) };
    Object.keys(extra || {}).forEach(k => { o[k] = cf.dimension(extra[k]); });
    return o;
  };
  CF.ships = mk(DATA.ships, { wilaya: r => r.wilaya, transport: r => r.transport });
  CF.pays = mk(DATA.pays, { rep: r => r.rep, code: r => r.code });
  CF.visits = mk(DATA.visits, { rep: r => r.rep });

  const sumNK = { add: (p, r) => { p.n++; p.k += r.colis; return p; }, rem: (p, r) => { p.n--; p.k -= r.colis; return p; }, ini: () => ({ n: 0, k: 0 }) };
  CF.ships.trend = CF.ships.ym.group().reduce(sumNK.add, sumNK.rem, sumNK.ini);
  CF.ships.byWilaya = CF.ships.wilaya.group();
  CF.ships.byTransport = CF.ships.transport.group();
  CF.ships.byRegion = CF.ships.region.group();
  CF.ships.conf = CF.ships.cf.groupAll().reduce(
    (p, r) => { if (r.hasCall) { p.total++; if (r.confirmed) p.yes++; } p.n++; p.k += r.colis; return p; },
    (p, r) => { if (r.hasCall) { p.total--; if (r.confirmed) p.yes--; } p.n--; p.k -= r.colis; return p; },
    () => ({ total: 0, yes: 0, n: 0, k: 0 })
  );

  const sumAN = { add: (p, r) => { p.n++; p.s += r.amount; return p; }, rem: (p, r) => { p.n--; p.s -= r.amount; return p; }, ini: () => ({ n: 0, s: 0 }) };
  CF.pays.trend = CF.pays.ym.group().reduce(sumAN.add, sumAN.rem, sumAN.ini);
  CF.pays.byRegion = CF.pays.region.group().reduce(sumAN.add, sumAN.rem, sumAN.ini);
  CF.pays.byRep = CF.pays.rep.group().reduce(sumAN.add, sumAN.rem, sumAN.ini);
  CF.pays.byClient = CF.pays.code.group().reduce(sumAN.add, sumAN.rem, sumAN.ini);
  CF.pays.all = CF.pays.cf.groupAll().reduce(sumAN.add, sumAN.rem, sumAN.ini);

  applyFilters();
}

function effectivePeriod() {
  const now = new Date();
  return {
    months: S.months.size ? S.months : new Set([now.getMonth() + 1]),
    years: S.years.size ? S.years : new Set([now.getFullYear()])
  };
}

function setDim(dim, set) {
  if (set && set.size) dim.filterFunction(v => set.has(v)); else dim.filterAll();
}

/** يطبّق حالة S على كل أبعاد Crossfilter — بعدها كل group.all() تعكس الفلاتر فورًا */
function applyFilters() {
  if (!CF.ships) return;
  const { months, years } = effectivePeriod();
  const periodFn = ym => ym >= 0 && months.has((ym % 12) + 1) && years.has(Math.floor(ym / 12));
  [CF.ships, CF.pays, CF.visits].forEach(o => {
    setDim(o.region, S.regions);
    o.ym.filterFunction(periodFn);
  });
  setDim(CF.ships.wilaya, S.wilaya);
  setDim(CF.ships.transport, S.transport);
  setDim(CF.pays.rep, S.rep);
  setDim(CF.visits.rep, S.rep);
}

/** آخر 6 أشهر (مفاتيح ym) تنتهي بالشهر الحالي */
function last6Yms() {
  const cur = ymOf(new Date());
  const arr = [];
  for (let i = 5; i >= 0; i--) arr.push(cur - i);
  return arr;
}

/** يحوّل group.all() إلى قائمة {name,value} مرتبة تنازليًا بلا الأصفار والقيم الفارغة */
function topOf(group, valueFn, limit) {
  return group.all()
    .map(g => ({ name: g.key, value: valueFn(g.value) }))
    .filter(x => x.name !== '' && x.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit || 8);
}

// ---------- ECharts ----------
function themeColors() {
  const cs = getComputedStyle(document.body);
  const g = n => cs.getPropertyValue(n).trim();
  return { text: g('--text'), muted: g('--text-muted'), border: g('--border'), surface: g('--surface'), primary: g('--primary') };
}

function disposeCharts(root) {
  (root || document).querySelectorAll('.chart').forEach(el => {
    const inst = echarts.getInstanceByDom(el);
    if (inst) inst.dispose();
  });
}

function mountChart(el, option, onClick, onCategory) {
  const inst = echarts.init(el, null, { renderer: 'canvas' });
  inst.setOption(option);
  if (onClick) inst.on('click', onClick);
  // نقرة في أي مكان داخل منطقة الرسم تختار أقرب تصنيف على المحور (أسهل للمس من إصابة النقطة بالضبط)
  if (onCategory) {
    inst.getZr().on('click', e => {
      const pt = [e.offsetX, e.offsetY];
      if (!inst.containPixel('grid', pt)) return;
      const idx = Math.round(inst.convertFromPixel({ seriesIndex: 0 }, pt)[0]);
      if (idx >= 0) onCategory(idx);
    });
  }
  return inst;
}

window.addEventListener('resize', () => {
  document.querySelectorAll('.chart').forEach(el => {
    const inst = echarts.getInstanceByDom(el);
    if (inst) inst.resize();
  });
});

const BASE_TEXT = () => { const t = themeColors(); return { color: t.text, fontFamily: 'Segoe UI, Tahoma, Arial, sans-serif' }; };

/** أعمدة أفقية؛ العناصر المختارة (selSet) تبقى بلون كامل والباقي يخفت */
function barOption(items, opts) {
  opts = opts || {};
  const t = themeColors();
  const sel = opts.selected && opts.selected.size ? opts.selected : null;
  return {
    textStyle: BASE_TEXT(),
    grid: { left: 8, right: 70, top: 6, bottom: 6, containLabel: true },
    tooltip: { trigger: 'item', confine: true, formatter: p => esc(p.name) + '<br/><b>' + (opts.fmt || fmtNum)(p.value) + '</b>' },
    xAxis: { type: 'value', show: false },
    yAxis: {
      type: 'category', inverse: true, data: items.map(i => i.name),
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: t.muted, width: 90, overflow: 'truncate', fontSize: 12 }
    },
    series: [{
      type: 'bar', barMaxWidth: 16,
      data: items.map((it, i) => ({
        value: it.value,
        itemStyle: {
          color: PALETTE[i % PALETTE.length], borderRadius: [0, 6, 6, 0],
          opacity: sel && !sel.has(it.name) ? 0.28 : 1
        }
      })),
      label: { show: true, position: 'right', color: t.text, fontSize: 11, formatter: p => (opts.fmt || fmtNum)(p.value) },
      emphasis: { focus: 'self' }
    }]
  };
}

function barHeight(n) { return Math.max(120, n * 34 + 16); }

/** منحنى ناعم بمساحة متدرجة؛ النقر على نقطة يختار ذلك الشهر */
function trendOption(labels, series) {
  const t = themeColors();
  return {
    textStyle: BASE_TEXT(),
    color: series.map(s => s.color),
    grid: { left: 10, right: 14, top: series.length > 1 ? 34 : 14, bottom: 4, containLabel: true },
    legend: series.length > 1 ? { top: 0, textStyle: { color: t.muted } } : undefined,
    tooltip: { trigger: 'axis', confine: true, valueFormatter: v => fmtNum(v) },
    xAxis: { type: 'category', data: labels, boundaryGap: false, axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.muted, fontSize: 10, interval: 0 } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.muted, fontSize: 10.5, formatter: v => v >= 1000000 ? (v / 1000000) + 'M' : (v >= 1000 ? (v / 1000) + 'k' : v) } },
    series: series.map(s => ({
      name: s.name, type: 'line', smooth: true, symbolSize: 8, data: s.data, yAxisIndex: 0,
      lineStyle: { width: 3, color: s.color }, itemStyle: { color: s.color },
      areaStyle: series.length === 1 ? { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: s.color + '55' }, { offset: 1, color: s.color + '00' }]) } : undefined
    }))
  };
}

function donutOption(pct, color, sub) {
  const t = themeColors();
  return {
    textStyle: BASE_TEXT(),
    title: { text: Math.round(pct || 0) + '%', left: 'center', top: 'center', textStyle: { color: t.text, fontSize: 24, fontWeight: 800 } },
    series: [{
      type: 'pie', radius: ['68%', '88%'], silent: true, label: { show: false },
      data: [
        { value: pct || 0, itemStyle: { color: color, borderRadius: 8 } },
        { value: Math.max(0, 100 - (pct || 0)), itemStyle: { color: t.border } }
      ]
    }]
  };
}

/** أعمدة أفقية مكدّسة (حالات الزيارات لكل منطقة) */
function stackedOption(rows, defs, selected) {
  const t = themeColors();
  const sel = selected && selected.size ? selected : null;
  return {
    textStyle: BASE_TEXT(),
    grid: { left: 8, right: 14, top: 30, bottom: 6, containLabel: true },
    legend: { top: 0, textStyle: { color: t.muted, fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true },
    xAxis: { type: 'value', show: false },
    yAxis: { type: 'category', inverse: true, data: rows.map(r => r.region), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.muted, fontSize: 12 } },
    series: defs.map(d => ({
      name: d.label, type: 'bar', stack: 'v', barMaxWidth: 20,
      itemStyle: { color: d.color },
      data: rows.map(r => ({ value: r[d.key], itemStyle: { opacity: sel && !sel.has(r.region) ? 0.28 : 1 } })),
      emphasis: { focus: 'series' }
    }))
  };
}

// ---------- أدوات HTML ----------
function chartBox(id, height, title) {
  return (title ? '<h3 class="section-title">' + title + '</h3>' : '') +
    '<div class="chart-card"><div class="chart" id="' + id + '" style="height:' + height + 'px"></div></div>';
}
function statRow(items) {
  return '<div class="client-stats">' + items.map(i =>
    '<div class="stat-chip"><div class="stat-value">' + i.value + '</div><div class="stat-label">' + i.label + '</div></div>').join('') + '</div>';
}
function toggleIn(set, v) { if (set.has(v)) set.delete(v); else set.add(v); }
