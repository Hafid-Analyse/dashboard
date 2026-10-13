'use strict';
/* ============================================================
   data.js — جلب البيانات، كاش محلي (IndexedDB)، تجهيز الصفوف، وحالة الفلاتر العامة
   ============================================================ */

const DATA = {
  clients: [], ships: [], pays: [], visits: [], bal: {},
  clientByCode: {}, shipsBy: {}, paysBy: {}, visitsBy: {},
  regions: [], years: [], generatedAt: null, buildMs: 0
};

/** حالة الفلاتر العامة — مشتركة بين كل الصفحات */
const S = {
  regions: new Set(),   // فارغ = كل المناطق
  months: new Set(),    // فارغ = الشهر الحالي
  years: new Set(),     // فارغ = السنة الحالية
  wilaya: new Set(),    // فلاتر ثانوية تُفعَّل بالضغط على الرسوم
  transport: new Set(),
  rep: new Set()
};

const MONTH_NAMES = ['جانفي','فيفري','مارس','أفريل','ماي','جوان','جويلية','أوت','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

// ---------- أدوات صغيرة ----------
function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtNum(n) { return new Intl.NumberFormat('ar-DZ').format(Math.round(n || 0)); }
function fmtDate(d) {
  if (!d) return '—';
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}
function parseISO(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
}
function ymOf(d) { return d ? d.getFullYear() * 12 + d.getMonth() : -1; }
function ymLabel(ym) { return MONTH_NAMES[ym % 12] + ' ' + Math.floor(ym / 12); }
function daysBetween(a, b) { return Math.floor((a - b) / 86400000); }

function isConfirmed(v) {
  const s = String(v || '').trim();
  if (!s) return false;
  return s.indexOf('تم') !== -1 || /^(نعم|yes|oui|confirmed)$/i.test(s);
}
function visitStatusOf(note) {
  const n = String(note || '');
  if (n.indexOf('لم يوجد') !== -1 || n.indexOf('لم أجده') !== -1) return 'notFound';
  if (n.indexOf('لم تتم') !== -1) return 'notDone';
  return 'done';
}

// ---------- تجهيز الصفوف ----------
function prepareData(p) {
  const clients = (p.clients || []).map(c => ({
    code: c.c, name: c.n || c.c, wilaya: c.w, ville: c.v, region: c.r || 'غير محدد',
    tel: c.t, address: c.a, created: parseISO(c.d), lastSale: parseISO(c.s), row: c.i || 0
  }));
  const clientByCode = {};
  clients.forEach(c => { clientByCode[c.code] = c; });
  const regOf = code => (clientByCode[code] ? clientByCode[code].region : '');

  const ships = (p.shipments || []).map(r => {
    const d = parseISO(r.d);
    return {
      date: d, ym: ymOf(d), day: d ? d.getDate() : 0, code: r.c, colis: r.k || 0,
      region: r.r || regOf(r.c) || 'غير محدد', wilaya: r.w || '', transport: r.t || '',
      call: r.p || '', remark: r.m || '', hasCall: !!r.p, confirmed: isConfirmed(r.p), row: r.i || 0
    };
  });
  const pays = (p.payments || []).map(r => {
    const d = parseISO(r.d);
    return {
      date: d, ym: ymOf(d), day: d ? d.getDate() : 0, code: r.c, amount: r.a || 0,
      rep: r.p || 'غير محدد', clientName: r.n || '', region: regOf(r.c) || 'غير محدد', row: r.i || 0
    };
  });
  const visits = (p.visits || []).map(r => {
    const d = parseISO(r.d);
    return {
      date: d, ym: ymOf(d), day: d ? d.getDate() : 0, ts: d ? d.getTime() : 0, code: r.c,
      note: r.n || '', rep: r.p || 'غير محدد', region: r.r || regOf(r.c) || 'غير محدد',
      status: visitStatusOf(r.n), success: String(r.n || '').indexOf('تمت') !== -1, row: r.i || 0
    };
  });
  const bal = {};
  (p.balances || []).forEach(b => { bal[b.c] = { cr: b.cr || 0, dt: b.dt || 0 }; });

  const index = (arr) => {
    const m = {};
    arr.forEach(r => { if (r.code) (m[r.code] = m[r.code] || []).push(r); });
    return m;
  };

  DATA.clients = clients; DATA.ships = ships; DATA.pays = pays; DATA.visits = visits; DATA.bal = bal;
  DATA.clientByCode = clientByCode;
  DATA.shipsBy = index(ships); DATA.paysBy = index(pays); DATA.visitsBy = index(visits);
  DATA.regions = Array.from(new Set(clients.map(c => c.region))).sort((a, b) => a.localeCompare(b, 'ar'));
  const ys = new Set([new Date().getFullYear()]);
  [ships, pays, visits].forEach(arr => arr.forEach(r => { if (r.date) ys.add(r.date.getFullYear()); }));
  DATA.years = Array.from(ys).sort((a, b) => b - a);
  DATA.generatedAt = p.generatedAt ? new Date(p.generatedAt) : new Date();
  DATA.buildMs = p.buildMs || 0;

  // تنظيف الفلاتر من قيم لم تعد موجودة
  S.regions.forEach(r => { if (DATA.regions.indexOf(r) === -1) S.regions.delete(r); });
}

// ---------- كاش محلي في IndexedDB (عرض فوري ثم تحديث في الخلفية) ----------
const IDB = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject) => {
      try {
        const rq = indexedDB.open('ceo_dashboard', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
        rq.onsuccess = () => { this._db = rq.result; resolve(this._db); };
        rq.onerror = () => reject(rq.error);
      } catch (e) { reject(e); }
    });
  },
  get(key) {
    return this.open().then(db => new Promise((resolve, reject) => {
      const rq = db.transaction('kv').objectStore('kv').get(key);
      rq.onsuccess = () => resolve(rq.result || null);
      rq.onerror = () => reject(rq.error);
    })).catch(() => null);
  },
  set(key, val) {
    return this.open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    })).catch(() => false);
  }
};

// ---------- الجلب من Apps Script ----------
function apiConfigured() {
  const u = (window.CEO_CONFIG || {}).API_URL || '';
  return /^https:\/\/script\.google(usercontent)?\.com\//.test(u);
}

async function fetchPayload(forceRefresh) {
  const base = window.CEO_CONFIG.API_URL;
  const url = base + (base.indexOf('?') === -1 ? '?' : '&') + (forceRefresh ? 'refresh=1&' : '') + 't=' + Date.now();
  const res = await fetch(url, { method: 'GET', redirect: 'follow' });
  if (!res.ok) throw new Error('فشل الاتصال بالخادم (' + res.status + ')');
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); }
  catch (e) { throw new Error('الرد ليس JSON — تأكد أن النشر "Anyone" وأن الرابط ينتهي بـ /exec'); }
  if (json.error) throw new Error('خطأ من الخادم: ' + json.error);
  return json;
}
