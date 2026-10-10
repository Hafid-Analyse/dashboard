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

  const sumNK = {
    add: (p, r) => { p.n++; p.k += r.colis; if (r.hasCall) { p.tot++; if (r.confirmed) p.yes++; } return p; },
    rem: (p, r) => { p.n--; p.k -= r.colis; if (r.hasCall) { p.tot--; if (r.confirmed) p.yes--; } return p; },
    ini: () => ({ n: 0, k: 0, yes: 0, tot: 0 })
  };
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
const GOOD = '#35e2a4', BAD = '#ff5c72';

function isDark() { return document.body.classList.contains('dark'); }
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

function resizeAllCharts() {
  document.querySelectorAll('.chart').forEach(el => {
    const inst = echarts.getInstanceByDom(el);
    if (inst) inst.resize();
  });
}
window.addEventListener('resize', resizeAllCharts);

const BASE_TEXT = () => { const t = themeColors(); return { color: t.text, fontFamily: 'Segoe UI, Tahoma, Arial, sans-serif' }; };

function compact(v) {
  v = Math.abs(v) >= 1 ? v : 0;
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (Math.abs(v) >= 1e3) return Math.round(v / 1e3) + 'k';
  return String(Math.round(v));
}

/**
 * أعمدة أفقية بلون واحد (اللون للدلالة لا للزينة).
 * opts.selected: العناصر المختارة تبقى بكامل لونها والباقي يخفت.
 * opts.signed: موجب أخضر وسالب أحمر (للتغيّرات).
 */
function barOption(items, opts) {
  opts = opts || {};
  const t = themeColors();
  const sel = opts.selected && opts.selected.size ? opts.selected : null;
  const fmt = opts.fmt || fmtNum;
  const base = opts.color || t.primary;
  return {
    textStyle: BASE_TEXT(),
    grid: { left: 8, right: 70, top: 6, bottom: 6, containLabel: true },
    tooltip: { trigger: 'item', confine: true, formatter: p => esc(p.name) + '<br/><b>' + fmt(p.value) + '</b>' },
    xAxis: { type: 'value', show: false },
    yAxis: {
      type: 'category', inverse: true, data: items.map(i => i.name),
      axisLine: { show: false, onZero: false }, axisTick: { show: false },
      axisLabel: { color: t.muted, width: 100, overflow: 'truncate', fontSize: 12 }
    },
    series: [{
      type: 'bar', barMaxWidth: 16,
      data: items.map(it => ({
        value: it.value,
        itemStyle: {
          color: opts.signed ? (it.value >= 0 ? GOOD : BAD) : base,
          borderRadius: it.value >= 0 ? [0, 6, 6, 0] : [6, 0, 0, 6],
          opacity: sel && !sel.has(it.name) ? 0.28 : 1
        },
        label: { position: it.value >= 0 ? 'right' : 'left' }
      })),
      label: { show: true, color: t.text, fontSize: 11, formatter: p => (opts.signed && p.value > 0 ? '+' : '') + fmt(p.value) },
      emphasis: { focus: 'self' }
    }]
  };
}

function barHeight(n) { return Math.max(120, n * 34 + 16); }

/**
 * منحنى ناعم. opts.partial (افتراضي true): آخر نقطة = شهر لم يكتمل فتُرسم بخط متقطع
 * وتسمية "حتى اليوم" حتى لا يبدو الهبوط الأخير حقيقيًا.
 * series[i].axis = 1 يضع السلسلة على محور ثانٍ (يمين).
 */
function trendOption(labels, series, opts) {
  opts = opts || {};
  const t = themeColors();
  const partial = opts.partial !== false && labels.length > 1;
  const last = labels.length - 1;
  const fmt = opts.fmt || fmtNum;
  const dual = series.some(s => s.axis === 1);
  const single = series.length === 1;
  const axisFmt = v => opts.pct ? v + '%' : compact(v);

  const out = [];
  series.forEach(s => {
    const base = { name: s.name, type: 'line', smooth: true, symbolSize: 8, yAxisIndex: s.axis || 0, itemStyle: { color: s.color }, connectNulls: false };
    const area = single ? { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: s.color + '55' }, { offset: 1, color: s.color + '00' }]) } : undefined;
    if (!partial) { out.push({ ...base, data: s.data, lineStyle: { width: 3, color: s.color }, areaStyle: area }); return; }
    out.push({ ...base, data: s.data.map((v, i) => i === last ? null : v), lineStyle: { width: 3, color: s.color }, areaStyle: area });
    out.push({
      ...base, name: s.name + ' (غير مكتمل)',
      data: s.data.map((v, i) => i === last - 1 ? { value: v, symbolSize: 0 } : (i === last ? v : null)),
      lineStyle: { width: 3, type: 'dashed', color: s.color }, areaStyle: area
    });
  });

  const yAxisBase = (color, show) => ({
    type: 'value', min: 0, max: opts.yMax, splitLine: { show, lineStyle: { color: t.border } },
    axisLabel: { color: color, fontSize: 10.5, formatter: axisFmt }
  });
  const colors = series.map(s => s.color);
  return {
    textStyle: BASE_TEXT(),
    grid: { left: 10, right: partial ? 34 : 14, top: single ? 14 : 34, bottom: 4, containLabel: true },
    legend: single ? undefined : { top: 0, data: series.map(s => s.name), textStyle: { color: t.muted } },
    tooltip: {
      trigger: 'axis', confine: true,
      formatter: ps => {
        const idx = ps[0].dataIndex, seen = {};
        let h = '<b>' + esc(labels[idx]) + '</b>';
        ps.forEach(p => {
          const nm = p.seriesName.replace(' (غير مكتمل)', '');
          if (seen[nm] || p.value === null || p.value === undefined) return;
          seen[nm] = 1;
          h += '<br/>' + p.marker + esc(nm) + ': <b>' + fmt(p.value) + '</b>' + (partial && idx === last ? ' <span style="opacity:.7">(حتى اليوم)</span>' : '');
        });
        return h;
      }
    },
    xAxis: {
      type: 'category', boundaryGap: false,
      data: labels.map((l, i) => partial && i === last ? l + '\n(حتى اليوم)' : l),
      axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.muted, fontSize: 10, interval: 0 }
    },
    yAxis: dual ? [yAxisBase(colors[0], true), { ...yAxisBase(colors[1] || t.muted, false) }] : yAxisBase(t.muted, true),
    series: out
  };
}

/** أعمدة أفقية مكدّسة بالنسبة المئوية (100% لكل منطقة) مع العدد الفعلي في التلميح */
function stackedPctOption(rows, defs, selected) {
  const t = themeColors();
  const sel = selected && selected.size ? selected : null;
  return {
    textStyle: BASE_TEXT(),
    grid: { left: 8, right: 14, top: 30, bottom: 6, containLabel: true },
    legend: { top: 0, textStyle: { color: t.muted, fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true,
      formatter: ps => {
        const r = rows[ps[0].dataIndex];
        let h = '<b>' + esc(r.region) + '</b> — ' + r.total + ' زبون';
        defs.forEach(d => { h += '<br/><span style="color:' + d.color + '">●</span> ' + d.label + ': <b>' + r[d.key] + '</b> (' + (r.total ? Math.round(r[d.key] / r.total * 100) : 0) + '%)'; });
        return h;
      }
    },
    xAxis: { type: 'value', show: false, max: 100 },
    yAxis: { type: 'category', inverse: true, data: rows.map(r => r.region), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.muted, fontSize: 12 } },
    series: defs.map(d => ({
      name: d.label, type: 'bar', stack: 'v', barMaxWidth: 22,
      itemStyle: { color: d.color },
      data: rows.map(r => ({ value: r.total ? r[d.key] / r.total * 100 : 0, itemStyle: { opacity: sel && !sel.has(r.region) ? 0.28 : 1 } })),
      emphasis: { focus: 'series' }
    }))
  };
}

/** خريطة حرارية: صفوف = مناطق، أعمدة = أشهر */
function heatmapOption(rowNames, colLabels, matrix, max, fmt, selectedRows) {
  const t = themeColors();
  const dark = isDark();
  const sel = selectedRows && selectedRows.size ? selectedRows : null;
  return {
    textStyle: BASE_TEXT(),
    grid: { left: 8, right: 8, top: 6, bottom: 4, containLabel: true },
    tooltip: { confine: true, formatter: p => esc(rowNames[p.value[1]]) + ' — ' + esc(colLabels[p.value[0]]) + '<br/><b>' + (fmt || fmtNum)(p.value[2]) + '</b>' },
    xAxis: { type: 'category', data: colLabels, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.muted, fontSize: 10, interval: 0 } },
    yAxis: { type: 'category', data: rowNames, inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.muted, fontSize: 12 } },
    visualMap: { show: false, min: 0, max: Math.max(1, max), inRange: { color: dark ? ['#3a2230', '#ff8fab'] : ['#fde4ee', '#c2185b'] } },
    series: [{
      type: 'heatmap',
      data: matrix.map(m => ({
        value: m,
        itemStyle: { opacity: sel && !sel.has(rowNames[m[1]]) ? 0.3 : 1 },
        label: { color: (m[2] / Math.max(1, max)) > 0.55 ? (dark ? '#2a1420' : '#fff') : t.text }
      })),
      label: { show: true, fontSize: 10, formatter: p => p.value[2] ? compact(p.value[2]) : '' },
      itemStyle: { borderColor: t.surface, borderWidth: 3, borderRadius: 6 }
    }]
  };
}

// ---------- أدوات HTML ----------
function chartBox(id, height, title) {
  return (title ? '<h3 class="section-title">' + title + '</h3>' : '') +
    '<div class="chart-card"><div class="chart" id="' + id + '" style="height:' + height + 'px"></div></div>';
}
function statRow(items) {
  return '<div class="client-stats">' + items.map(i =>
    '<div class="stat-chip' + (i.cls ? ' ' + i.cls : '') + '"><div class="stat-value">' + i.value + '</div><div class="stat-label">' + i.label + '</div></div>').join('') + '</div>';
}
function grid2(a, b) { return '<div class="grid-2"><div>' + a + '</div><div>' + b + '</div></div>'; }
function toggleIn(set, v) { if (set.has(v)) set.delete(v); else set.add(v); }
