'use strict';

/* ===== バージョン ===== */

// 更新のたびに sw.js の VERSION、index.html の ?v= と同じ番号に上げる
const APP_VERSION = 2;
const APP_UPDATED = '2026-11-04';

function renderVersion(el) {
  const src = document.querySelector('script[src*="app.js"]')?.getAttribute('src') || '';
  const html = new URL(src, location.href).searchParams.get('v');
  const mixed = html !== String(APP_VERSION);
  el.classList.toggle('mixed', mixed);
  el.textContent = mixed
    ? `⚠ 古いファイルが混ざっています(画面 ver ${html ?? '?'} / 動作 ver ${APP_VERSION})。アプリを閉じて開き直してください`
    : `TEMPO ver ${APP_VERSION}（${APP_UPDATED} 更新）`;
}

/* ===== 保存 ===== */

// はよ寝てやと同じサイトなので、キー名を分けて記録が混ざらないようにする
const STORE_KEY = 'tempo_v1_store';
const RUN_KEY = 'tempo_v1_run';
const MAX_RECORDS = 500;
const UNITS = ['ページ', '大問'];

const DEFAULT_SETTINGS = {
  cautionPct: 100,   // 今の1回が目標の何%を超えたら「注意」
  warnPct: 150,      // 何%を超えたら「警告(ダレ)」
  slumpPct: 120,     // 直近の平均が全体平均の何%以上で「ペース低下」
  slumpWindow: 3,    // 直近として見る回数
  sound: true,
  libraryDefault: false,
};

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    alert('保存に失敗しました。ブラウザの容量や設定を確認してください。');
  }
}

const store = (() => {
  const d = loadJson(STORE_KEY, {});
  return {
    settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) },
    setup: { title: '', unit: UNITS[0], targetSec: 300, ...(d.setup || {}) },
    records: Array.isArray(d.records) ? d.records : [],
  };
})();

function persist() {
  store.records.sort((a, b) => a.startedAt - b.startedAt);
  if (store.records.length > MAX_RECORDS) store.records.splice(0, store.records.length - MAX_RECORDS);
  saveJson(STORE_KEY, store);
}

/* ===== 書式・計算 ===== */

const pad = (n) => String(n).padStart(2, '0');
const $ = (id) => document.getElementById(id);

/** 秒を M:SS(1時間以上は H:MM:SS)にする */
function fmt(sec) {
  const t = Math.floor(Math.abs(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// 貯金などの差は四捨五入(59.7秒 → +1:00)
const fmtSigned = (sec) => (sec >= 0 ? '+' : '−') + fmt(Math.round(Math.abs(sec)));

function fmtDate(ms) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}(${'日月火水木金土'[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function stdev(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/** 完了した各回の秒数から、表示する数字をまとめて計算する */
function summarize(laps, targetSec, windowSize = store.settings.slumpWindow) {
  const n = laps.length;
  const recent = laps.slice(-windowSize);
  return {
    n,
    avg: mean(laps),
    recentAvg: n >= windowSize ? mean(recent) : null,
    best: n ? Math.min(...laps) : null,
    worst: n ? Math.max(...laps) : null,
    saved: laps.reduce((s, x) => s + (targetSec - x), 0), // + なら目標より早い(貯金)
    withinRate: n ? laps.filter((x) => x <= targetSec).length / n : null,
    sd: stdev(laps),
    total: laps.reduce((a, b) => a + b, 0),
  };
}

/** ペース低下: 直近 window 回の平均が全体平均の slumpPct% 以上(window+1 回以上こなしてから判定) */
function isSlump(laps) {
  const w = store.settings.slumpWindow;
  if (laps.length < Math.max(w + 1, 4)) return false;
  return mean(laps.slice(-w)) >= mean(laps) * (store.settings.slumpPct / 100);
}

/** 今の1回の段階: ok / caution / warn */
function levelOf(lapSec, targetSec) {
  const pct = (lapSec / targetSec) * 100;
  if (pct >= store.settings.warnPct) return 'warn';
  if (pct >= store.settings.cautionPct) return 'caution';
  return 'ok';
}

const LEVEL_RANK = { ok: 0, caution: 1, warn: 2 };

/* ===== 画面遷移 ===== */

let currentScreen = 'setup';

function go(name) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== name;
  currentScreen = name;
  if (name !== 'play') setPlayClasses('ok', false, false);
  if (name === 'setup') renderSetup();
  if (name === 'history') renderHistory();
  if (name === 'settings') renderSettings();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]');
  if (b) go(b.dataset.go);
});

/* ===== スタート画面 ===== */

function renderSetup() {
  const s = store.setup;
  $('setup-title').value = s.title;
  $('setup-unit').innerHTML = UNITS.map((u) =>
    `<button type="button" role="radio" data-unit="${esc(u)}" aria-checked="${u === s.unit}">${esc(u)}</button>`).join('');
  for (const el of document.querySelectorAll('.unit-name')) el.textContent = s.unit;
  $('setup-min').value = Math.floor(s.targetSec / 60);
  $('setup-sec').value = pad(s.targetSec % 60);
  $('setup-library').checked = store.settings.libraryDefault;
  document.body.classList.toggle('lib', false);

  const titles = [...new Set(store.records.map((r) => r.title).filter(Boolean).reverse())].slice(0, 10);
  $('title-list').innerHTML = titles.map((t) => `<option value="${esc(t)}"></option>`).join('');

  const last = store.records[store.records.length - 1];
  $('setup-last').innerHTML = last
    ? `前回 ${esc(fmtDate(last.startedAt))}　${esc(last.title || '無題')}<br>` +
      `${last.laps.length}${esc(last.unit)} ・ 平均 <b>${fmt(mean(last.laps))}</b> ／ 目標 ${fmt(last.targetSec)}`
    : '';
}

function readTarget() {
  const m = Math.max(0, Math.min(180, Number($('setup-min').value) || 0));
  const s = Math.max(0, Math.min(59, Number($('setup-sec').value) || 0));
  return Math.max(10, m * 60 + s);
}

function setTarget(sec) {
  store.setup.targetSec = Math.max(10, Math.min(180 * 60, sec));
  $('setup-min').value = Math.floor(store.setup.targetSec / 60);
  $('setup-sec').value = pad(store.setup.targetSec % 60);
}

$('setup-unit').addEventListener('click', (e) => {
  const b = e.target.closest('[data-unit]');
  if (!b) return;
  store.setup.unit = b.dataset.unit;
  store.setup.title = $('setup-title').value.trim();
  store.setup.targetSec = readTarget();
  renderSetup();
});

for (const b of document.querySelectorAll('.step')) {
  b.addEventListener('click', () => setTarget(readTarget() + Number(b.dataset.step)));
}
for (const id of ['setup-min', 'setup-sec']) {
  $(id).addEventListener('change', () => setTarget(readTarget()));
}

/* ===== 計測(壁時計方式: 経過 = (停止時刻 or 現在) - t0。一時停止のぶん t0 をずらす) ===== */

// { t0, startedAt, pausedAt, pausedMs, marks: [各回の終了時点の累積ms], levels: [各回の最高段階],
//   targetSec, unit, title, library, slumpCount }
let run = loadJson(RUN_KEY, null);
let rafId = 0;
let wakeLock = null;
let shownLevel = 'ok';

const elapsedMs = () => (run.pausedAt ?? Date.now()) - run.t0;
const saveRun = () => saveJson(RUN_KEY, run);

function lapsOf(marks) {
  return marks.map((m, i) => (m - (i ? marks[i - 1] : 0)) / 1000);
}

function startRun() {
  store.setup = { title: $('setup-title').value.trim(), unit: store.setup.unit, targetSec: readTarget() };
  persist();
  unlockAudio();
  const now = Date.now();
  run = {
    t0: now, startedAt: now, pausedAt: null, pausedMs: 0, marks: [], levels: [],
    targetSec: store.setup.targetSec, unit: store.setup.unit, title: store.setup.title,
    library: $('setup-library').checked, slumpCount: 0,
  };
  saveRun();
  enterPlay();
}

function enterPlay() {
  go('play');
  shownLevel = run.levels[run.marks.length] || 'ok';
  $('play-title').textContent = `${run.title || 'TEMPO'} ／ ${run.unit}`;
  $('play-target').textContent = `TARGET ${fmt(run.targetSec)}`;
  buildTicks();
  requestWakeLock();
  renderPlayStatic();
  cancelAnimationFrame(rafId);
  tick();
}

/** リングの目盛り: 12等分 + 注意・警告の位置に太い目盛り */
function buildTicks() {
  const g = $('ring-ticks');
  let s = '';
  for (let i = 0; i < 12; i++) s += tickLine(i / 12, 92, 98, '');
  const st = store.settings;
  for (const pct of [st.cautionPct, st.warnPct]) s += tickLine((pct / 100) % 1, 90, 100, 'mark');
  g.innerHTML = s;
}

function tickLine(frac, r1, r2, cls) {
  const a = frac * Math.PI * 2;
  const p = (r) => `${(100 + r * Math.cos(a)).toFixed(2)},${(100 + r * Math.sin(a)).toFixed(2)}`;
  const [x1, y1] = p(r1).split(',');
  const [x2, y2] = p(r2).split(',');
  return `<line class="ring-tick ${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
}

function setPlayClasses(level, slump, paused) {
  const b = document.body.classList;
  b.toggle('caution', level === 'caution');
  b.toggle('warn', level === 'warn');
  b.toggle('invert', level === 'warn');
  b.toggle('slump', slump);
  b.toggle('paused', paused);
}

function renderPlayStatic() {
  const laps = lapsOf(run.marks);
  const sm = summarize(laps, run.targetSec);
  document.body.classList.toggle('lib', !!run.library);
  $('btn-library').setAttribute('aria-pressed', String(!!run.library));
  $('btn-pause').textContent = run.pausedAt ? 'RESUME' : 'PAUSE';
  $('btn-undo').disabled = !run.marks.length;
  $('btn-next').disabled = !!run.pausedAt;
  $('play-no').textContent = `No. ${run.marks.length + 1}`;

  const w = store.settings.slumpWindow;
  const stats = [
    ['AVG', '平均', sm.avg != null ? fmt(sm.avg) : '—', true],
    [`LAST${w}`, `直近${w}`, sm.recentAvg != null ? fmt(sm.recentAvg) : '—'],
    ['BANK', '貯金', sm.n ? fmtSigned(sm.saved) : '—'],
    ['BEST', '最速', sm.best != null ? fmt(sm.best) : '—'],
    ['WORST', '最遅', sm.worst != null ? fmt(sm.worst) : '—'],
    ['IN', '目標内', sm.withinRate != null ? `${Math.round(sm.withinRate * 100)}%` : '—'],
  ];
  $('play-stats').innerHTML = stats.map(([k, jp, v, key]) =>
    `<div class="stat${key ? ' key' : ''}"><div class="stat-label">${k} <small>${jp}</small></div><div class="stat-val">${v}</div></div>`).join('');
}

function tick() {
  if (!run || currentScreen !== 'play') return;
  const total = elapsedMs() / 1000;
  const lapStart = run.marks.length ? run.marks[run.marks.length - 1] / 1000 : 0;
  const cur = total - lapStart;
  const ratio = cur / run.targetSec;

  $('play-total').textContent = fmt(total);
  $('play-lap').textContent = fmt(cur);
  setArc($('ring-1'), Math.min(1, ratio));
  setArc($('ring-2'), ratio > 1 ? Math.min(1, ratio - 1) : 0);

  const level = run.pausedAt ? shownLevel : levelOf(cur, run.targetSec);
  const idx = run.marks.length;
  if (LEVEL_RANK[level] > LEVEL_RANK[run.levels[idx] || 'ok']) {
    run.levels[idx] = level;
    saveRun();
  }
  if (level !== shownLevel) {
    if (LEVEL_RANK[level] > LEVEL_RANK[shownLevel]) notify(level === 'warn' ? 'warn' : 'caution');
    shownLevel = level;
  }
  const slump = isSlump(lapsOf(run.marks));
  setPlayClasses(level, slump, !!run.pausedAt);
  renderBanner(level, slump, cur);
  renderBars($('play-bars'), lapsOf(run.marks), run.targetSec, cur);

  rafId = requestAnimationFrame(tick);
}

function setArc(el, frac) {
  const r = Number(el.getAttribute('r'));
  const c = 2 * Math.PI * r;
  el.style.strokeDasharray = `${(c * frac).toFixed(2)} ${c.toFixed(2)}`;
}

let lastBanner = '';
function renderBanner(level, slump, cur) {
  let cls = '';
  let text = `${run.unit}を1つ終えたら NEXT`;
  if (run.pausedAt) text = 'PAUSED ／ 一時停止中';
  else if (level === 'warn') { cls = 'warn'; text = `ダレています。次へ進もう ／ 目標の${Math.round((cur / run.targetSec) * 100)}%`; }
  else if (level === 'caution') { cls = 'caution'; text = `目標超過 ${fmtSigned(cur - run.targetSec).replace('−', '')}`; }
  else if (slump) { cls = 'slump'; text = `ペースが落ちています ／ 直近${store.settings.slumpWindow}回の平均が遅め`; }
  const key = cls + text;
  if (key === lastBanner) return;
  lastBanner = key;
  const el = $('banner');
  el.className = 'banner ' + cls;
  el.textContent = text;
}

/** 各回の棒グラフ(目標内=グレー / 超過=黒 / 進行中=点線)。直近 maxBars 回を表示 */
function renderBars(el, laps, targetSec, cur = null, maxBars = 40) {
  const shown = laps.slice(-maxBars + (cur != null ? 1 : 0));
  const vals = cur != null ? [...shown, cur] : shown;
  if (!vals.length) { el.innerHTML = '<div class="bars-empty">ここに各回の時間が並びます</div>'; return; }
  const max = Math.max(targetSec * 1.6, ...vals);
  const h = (v) => `${Math.max(2, (v / max) * 100).toFixed(1)}%`;
  const html = shown.map((v) => `<div class="b${v > targetSec ? ' over' : ''}" style="height:${h(v)}" title="${fmt(v)}"></div>`);
  if (cur != null) html.push(`<div class="b cur" style="height:${h(cur)}"></div>`);
  html.push(`<div class="t" style="bottom:${((targetSec / max) * 100).toFixed(1)}%"><span>TARGET</span></div>`);
  el.innerHTML = html.join('');
}

function next() {
  if (!run || run.pausedAt) return;
  const wasSlump = isSlump(lapsOf(run.marks));
  run.marks.push(elapsedMs());
  const slump = isSlump(lapsOf(run.marks));
  if (slump && !wasSlump) { run.slumpCount++; notify('slump'); } else feedback();
  shownLevel = 'ok';
  saveRun();
  renderPlayStatic();
}

function undo() {
  if (!run || !run.marks.length) return;
  if (!confirm('直前の1回を取り消して、その回の続きから計測しますか？')) return;
  run.marks.pop();
  run.levels.length = run.marks.length + 1;
  shownLevel = run.levels[run.marks.length] || 'ok';
  saveRun();
  renderPlayStatic();
}

function togglePause() {
  if (!run) return;
  if (run.pausedAt) {
    const d = Date.now() - run.pausedAt;
    run.t0 += d;
    run.pausedMs += d;
    run.pausedAt = null;
  } else {
    run.pausedAt = Date.now();
  }
  saveRun();
  renderPlayStatic();
}

function toggleLibrary() {
  if (!run) return;
  run.library = !run.library;
  saveRun();
  renderPlayStatic();
}

function exitRun() {
  if (!run) return;
  const cur = elapsedMs() / 1000 - (run.marks.length ? run.marks[run.marks.length - 1] / 1000 : 0);
  const msg = run.marks.length
    ? `終了してリザルトへ進みますか？\n途中の1回(${fmt(cur)})は記録されません。`
    : 'まだ1回も終えていません。記録せずに終了しますか？';
  if (!confirm(msg)) return;
  cancelAnimationFrame(rafId);
  releaseWakeLock();
  if (!run.marks.length) {
    run = null;
    saveRun();
    go('setup');
    return;
  }
  if (run.pausedAt) togglePause(); // 一時停止中ならその時間も一時停止として数える
  pendingRecord = {
    id: new Date().toISOString(),
    startedAt: run.startedAt,
    endedAt: Date.now(),
    title: run.title,
    unit: run.unit,
    targetSec: run.targetSec,
    laps: lapsOf(run.marks).map((x) => Math.round(x * 10) / 10),
    levels: run.levels.slice(0, run.marks.length).map((l) => l || 'ok'),
    pausedMs: run.pausedMs,
    slumpCount: run.slumpCount,
    comment: '',
  };
  run = null;
  saveRun();
  showResult(pendingRecord);
}

$('btn-start').addEventListener('click', startRun);
$('btn-next').addEventListener('click', next);
$('btn-undo').addEventListener('click', undo);
$('btn-pause').addEventListener('click', togglePause);
$('btn-library').addEventListener('click', toggleLibrary);
$('btn-exit').addEventListener('click', exitRun);

/* ===== リザルト ===== */

let pendingRecord = null;

/** 記録から統計の表示(リザルトと詳細で共通) */
function statCells(r) {
  const sm = summarize(r.laps, r.targetSec);
  const warns = (r.levels || []).filter((l) => l === 'warn').length;
  return [
    ['COUNT', '回数', `${sm.n}${r.unit}`],
    ['TOTAL', '合計', fmt(sm.total)],
    ['BANK', '貯金', fmtSigned(sm.saved)],
    ['BEST', '最速', fmt(sm.best)],
    ['WORST', '最遅', fmt(sm.worst)],
    ['IN', '目標内', `${Math.round(sm.withinRate * 100)}%`],
    ['SD', 'ばらつき', sm.sd != null ? `±${fmt(sm.sd)}` : '—'],
    ['WARN', '警告', `${warns}回`],
    ['SLUMP', 'ペース低下', `${r.slumpCount || 0}回`],
  ].map(([k, jp, v]) => `<div class="stat"><div class="stat-label">${k} <small>${jp}</small></div><div class="stat-val">${v}</div></div>`).join('');
}

function showResult(r) {
  go('result');
  const avg = mean(r.laps);
  const diff = avg - r.targetSec;
  $('result-head').innerHTML = `<div class="cap">AVERAGE ／ 平均解答時間</div>
    <div class="big">${fmt(avg)}</div>
    <div class="sub">目標 ${fmt(r.targetSec)} ／ ${diff <= 0 ? `${fmt(-diff)} 速い` : `${fmt(diff)} 遅い`}　・　${esc(r.title || '無題')}</div>`;
  $('result-stats').innerHTML = statCells(r);
  renderBars($('result-bars'), r.laps, r.targetSec, null, 120);
  $('result-comment').value = '';
}

$('btn-save').addEventListener('click', () => {
  if (!pendingRecord) { go('setup'); return; }
  pendingRecord.comment = $('result-comment').value.trim();
  store.records.push(pendingRecord);
  persist();
  pendingRecord = null;
  go('history');
});

/* ===== 履歴 ===== */

let trendTitle = null;

function renderHistory() {
  const body = $('history-body');
  if (!store.records.length) {
    body.innerHTML = '<div class="empty">まだ記録がありません</div>';
    return;
  }
  const titles = [...new Set(store.records.map((r) => r.title || '無題'))];
  if (!titles.includes(trendTitle)) trendTitle = (store.records[store.records.length - 1].title || '無題');
  const list = [...store.records].reverse();
  body.innerHTML = `<h2 class="h-section">TREND ／ 平均の推移</h2>
    <div class="trend">
      <select id="trend-title" aria-label="教材">${titles.map((t) => `<option ${t === trendTitle ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
      <div id="trend-chart"></div>
    </div>
    <h2 class="h-section">LOG ／ 記録</h2>
    <div class="list">${list.map((r) => `<button class="row" data-record="${esc(r.id)}">
      <span class="r-title">${esc(r.title || '無題')}</span>
      <span class="r-avg">${fmt(mean(r.laps))}</span>
      <span class="r-sub">${esc(fmtDate(r.startedAt))} ・ ${r.laps.length}${esc(r.unit)} ・ 目標 ${fmt(r.targetSec)} ・ 合計 ${fmt(r.laps.reduce((a, b) => a + b, 0))}</span>
      ${r.comment ? `<span class="r-comment">— ${esc(r.comment)}</span>` : ''}
    </button>`).join('')}</div>`;
  renderTrend();
}

/** 教材ごとの平均時間の推移(白黒の折れ線 + 目標の点線) */
function renderTrend() {
  const recs = store.records.filter((r) => (r.title || '無題') === trendTitle);
  const el = $('trend-chart');
  if (recs.length < 2) {
    el.innerHTML = '<div class="empty" style="padding:16px 0">2回以上記録すると推移が出ます</div>';
    return;
  }
  const W = 320, H = 130, L = 40, R = 8, T = 10, B = 18;
  const avgs = recs.map((r) => mean(r.laps));
  const tgt = recs[recs.length - 1].targetSec;
  const lo = Math.min(...avgs, tgt) * 0.9;
  const hi = Math.max(...avgs, tgt) * 1.1;
  const X = (i) => L + (i * (W - L - R)) / (recs.length - 1);
  const Y = (v) => H - B - ((v - lo) / (hi - lo)) * (H - T - B);
  const step = [10, 15, 30, 60, 120, 300, 600].find((s) => (hi - lo) / s <= 4) || 600;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="平均時間の推移">`;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    s += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/>
      <text x="${L - 4}" y="${Y(v) + 3}" text-anchor="end" class="trend-axis">${fmt(v)}</text>`;
  }
  s += `<line x1="${L}" x2="${W - R}" y1="${Y(tgt)}" y2="${Y(tgt)}" stroke="var(--muted)" stroke-dasharray="4 3"/>`;
  s += `<polyline points="${avgs.map((v, i) => `${X(i)},${Y(v)}`).join(' ')}" fill="none" stroke="var(--ink)" stroke-width="2"/>`;
  avgs.forEach((v, i) => {
    // 目標内は白抜きの正方形、超過は黒の正方形
    s += `<rect x="${X(i) - 4}" y="${Y(v) - 4}" width="8" height="8" fill="${v <= tgt ? 'var(--bg)' : 'var(--ink)'}" stroke="var(--ink)" stroke-width="1.5"/>`;
  });
  const d = (r) => { const t = new Date(r.startedAt); return `${t.getMonth() + 1}/${t.getDate()}`; };
  s += `<text x="${L}" y="${H - 4}" class="trend-axis">${d(recs[0])}</text>
    <text x="${W - R}" y="${H - 4}" text-anchor="end" class="trend-axis">${d(recs[recs.length - 1])}</text></svg>`;
  el.innerHTML = s + `<div class="muted">■ 目標超過　□ 目標内　点線 = 目標 ${fmt(tgt)}</div>`;
}

$('history-body').addEventListener('change', (e) => {
  if (e.target.id === 'trend-title') { trendTitle = e.target.value; renderTrend(); }
});
$('history-body').addEventListener('click', (e) => {
  const row = e.target.closest('[data-record]');
  if (row) openDetail(row.dataset.record);
});

/* ===== 記録詳細 ===== */

let detailId = null;

function openDetail(id) {
  const r = store.records.find((x) => x.id === id);
  if (!r) return;
  detailId = id;
  $('detail-body').innerHTML = `<div class="d-title">${esc(r.title || '無題')}　平均 ${fmt(mean(r.laps))}</div>
    <div class="d-sub">${esc(fmtDate(r.startedAt))} ・ 目標 ${fmt(r.targetSec)} ／ ${esc(r.unit)}</div>
    <div class="stats wide">${statCells(r)}</div>
    <div id="detail-bars" class="bars tall"></div>`;
  renderBars($('detail-bars'), r.laps, r.targetSec, null, 120);
  $('detail-comment').value = r.comment || '';
  $('detail').showModal();
}

$('btn-detail-close').addEventListener('click', () => $('detail').close());
$('btn-detail-save').addEventListener('click', () => {
  const r = store.records.find((x) => x.id === detailId);
  if (!r) return;
  r.comment = $('detail-comment').value.trim();
  persist();
  $('detail').close();
  renderHistory();
});
$('btn-detail-delete').addEventListener('click', () => {
  if (!confirm('この記録を削除しますか？')) return;
  store.records = store.records.filter((r) => r.id !== detailId);
  persist();
  $('detail').close();
  renderHistory();
});

/* ===== 設定 ===== */

function renderSettings() {
  const f = $('settings-form');
  for (const k of ['cautionPct', 'warnPct', 'slumpPct', 'slumpWindow']) f[k].value = store.settings[k];
  f.sound.checked = store.settings.sound;
  f.libraryDefault.checked = store.settings.libraryDefault;
  renderVersion($('version'));
}

$('settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const caution = Number(f.cautionPct.value);
  const warn = Number(f.warnPct.value);
  if (warn <= caution) {
    alert('「警告」は「注意」より大きい値にしてください');
    return;
  }
  Object.assign(store.settings, {
    cautionPct: caution,
    warnPct: warn,
    slumpPct: Number(f.slumpPct.value),
    slumpWindow: Math.round(Number(f.slumpWindow.value)),
    sound: f.sound.checked,
    libraryDefault: f.libraryDefault.checked,
  });
  persist();
  go('setup');
});

$('btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  const d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `tempo-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('input-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const valid = (Array.isArray(data.records) ? data.records : [])
      .filter((r) => r && r.id && Array.isArray(r.laps) && typeof r.targetSec === 'number');
    const known = new Set(store.records.map((r) => r.id));
    const added = valid.filter((r) => !known.has(r.id));
    store.records.push(...added);
    persist();
    alert(`${added.length}件の記録を読み込みました`);
  } catch {
    alert('読み込めませんでした。TEMPO で書き出した JSON を選んでください。');
  }
});

$('btn-clear').addEventListener('click', () => {
  if (!confirm('すべての記録を削除します。元に戻せません。よろしいですか？')) return;
  store.records = [];
  persist();
  go('setup');
});

/* ===== 通知(図書館モードでは音もバイブも出さない) ===== */

let audioCtx = null;

function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { audioCtx = null; }
}

const silent = () => !run || run.library || !store.settings.sound;

function beep(freq, dur, when = 0) {
  if (silent() || !audioCtx) return;
  const t = audioCtx.currentTime + when;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.frequency.value = freq;
  osc.type = 'sine';
  gain.gain.setValueAtTime(0.12, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur);
}

function vibrate(pattern) {
  if (silent() || !navigator.vibrate) return;
  navigator.vibrate(pattern);
}

/** NEXT を押したときの軽い手応え */
function feedback() {
  vibrate(20);
  beep(1320, 0.05);
}

function notify(kind) {
  if (kind === 'warn') { vibrate([180, 80, 180, 80, 320]); [0, 0.22, 0.44].forEach((w) => beep(520, 0.16, w)); }
  else if (kind === 'caution') { vibrate(120); beep(880, 0.14); }
  else if (kind === 'slump') { vibrate([60, 60, 60]); beep(660, 0.1); beep(440, 0.16, 0.14); }
}

/* ===== 画面スリープ防止 ===== */

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* 非対応・拒否時は何もしない */ }
}

function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && run && currentScreen === 'play') requestWakeLock();
});

/* ===== 起動 ===== */

if (run && Array.isArray(run.marks)) enterPlay(); // 再読み込み・再起動でも続きから
else { run = null; saveRun(); go('setup'); }

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
