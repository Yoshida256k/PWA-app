'use strict';

/* ===== 保存 ===== */

const STORE_KEY = 'oyasumi_rta_v1';
const RUN_KEY = 'oyasumi_rta_run_v1';
const MAX_RECORDS = 1000;

const DEFAULT_SETTINGS = {
  targetBed: '22:45',
  sound: true,
  tasks: [
    { id: 'task0', name: 'ご飯', targetMin: 25 },
    { id: 'task1', name: 'お風呂', targetMin: 15 },
  ],
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
  const data = loadJson(STORE_KEY, {});
  const settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  settings.tasks = DEFAULT_SETTINGS.tasks.map((t, i) => ({ ...t, ...((data.settings?.tasks || [])[i] || {}) }));
  return { settings, records: Array.isArray(data.records) ? data.records : [] };
})();

function persist() {
  store.records.sort((a, b) => a.finishedAt - b.finishedAt);
  if (store.records.length > MAX_RECORDS) store.records.splice(0, store.records.length - MAX_RECORDS);
  saveJson(STORE_KEY, store);
}

/* ===== 書式 ===== */

const pad = (n) => String(n).padStart(2, '0');

/** RTA表記: 1時間以上は H:MM:SS、未満は MM:SS */
function fmtRta(sec) {
  const t = Math.floor(Math.abs(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function fmtCentis(sec) {
  return '.' + pad(Math.floor(Math.round(Math.abs(sec) * 1000) / 10) % 100);
}

function fmtDelta(sec) {
  return (sec <= 0 ? '-' : '+') + fmtRta(sec);
}

function fmtClock(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDate(ms) {
  const d = new Date(ms);
  const w = '日月火水木金土'[d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}(${w}) ${fmtClock(ms)}`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 夜の時刻を比較できるよう「正午からの分」にする(0:30 は 24:30 扱い) */
function nightMinutes(ms) {
  const d = new Date(ms);
  const m = d.getHours() * 60 + d.getMinutes();
  return m < 12 * 60 ? m + 24 * 60 : m;
}

function targetBedMinutes() {
  const [h, m] = store.settings.targetBed.split(':').map(Number);
  const v = h * 60 + m;
  return v < 12 * 60 ? v + 24 * 60 : v;
}

/* ===== 記録の集計 ===== */

const tasks = () => store.settings.tasks;
const targetSecOf = (i) => tasks()[i].targetMin * 60;
const targetTotalSec = () => tasks().reduce((s, t) => s + t.targetMin * 60, 0);

/** task_ver4 の computeRank と同じ基準(目標合計に対する短縮率) */
function computeRank(totalSec, targetSec) {
  const saved = targetSec - totalSec;
  if (saved > 0 && targetSec > 0) {
    const p = (saved / targetSec) * 100;
    if (p >= 30) return { rank: 'S', title: 'SPEEDRUN GOD!!', color: 'var(--yellow)' };
    if (p >= 15) return { rank: 'A', title: 'GREAT SPEED!', color: 'var(--accent)' };
    return { rank: 'B', title: 'FAST PACE!', color: 'var(--cyan)' };
  }
  return { rank: 'C', title: 'GOAL REACHED!', color: 'var(--muted)' };
}

function pbRecord(records = store.records) {
  let best = null;
  for (const r of records) if (!best || r.totalSec < best.totalSec) best = r;
  return best;
}

function bestSegment(i, records = store.records) {
  let best = null;
  for (const r of records) {
    const s = r.splits[i]?.sec;
    if (s != null && (best == null || s < best)) best = s;
  }
  return best;
}

function cumulative(splits) {
  let c = 0;
  return splits.map((s) => (c += s.sec));
}

/* ===== 画面遷移 ===== */

const $ = (id) => document.getElementById(id);
let currentScreen = 'home';

function go(name) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== name;
  currentScreen = name;
  if (name === 'home') renderHome();
  if (name === 'history') renderHistory();
  if (name === 'settings') renderSettings();
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-go]');
  if (btn) go(btn.dataset.go);
});

/* ===== ホーム ===== */

function renderHome() {
  $('home-now').textContent = fmtClock(Date.now());
  $('home-target-bed').textContent = store.settings.targetBed;

  const pb = pbRecord();
  const planSec = pb ? pb.totalSec : targetTotalSec();
  const endMs = Date.now() + planSec * 1000;
  const margin = targetBedMinutes() - nightMinutes(endMs);
  const fc = $('home-forecast');
  fc.className = 'forecast ' + (margin >= 0 ? 'ok' : 'ng');
  fc.textContent = `今から${pb ? 'PBペース' : '目標ペース'}で終わると ${fmtClock(endMs)} ` +
    (margin >= 0 ? `(あと${margin}分 余裕)` : `(${-margin}分 オーバー)`);

  const rows = tasks().map((t, i) => {
    const b = bestSegment(i);
    return `<div class="pb-item"><span class="name">${esc(t.name)}</span>
      <span class="muted small">目標 ${t.targetMin}分 / PB</span>
      <span class="pb">${b == null ? '--:--' : fmtRta(b)}</span></div>`;
  });
  rows.push(`<div class="pb-item total"><span class="name">合計</span>
    <span class="muted small">目標 ${fmtRta(targetTotalSec())} / PB</span>
    <span class="pb">${pb ? fmtRta(pb.totalSec) : '--:--'}</span></div>`);
  $('home-pbs').innerHTML = rows.join('');

  $('home-attempts').textContent = store.records.length;
  const recent = store.records.filter((r) => r.bedAt).slice(-7);
  const ok = recent.filter((r) => nightMinutes(r.bedAt) <= targetBedMinutes()).length;
  $('home-bed-ok').textContent = recent.length ? `${ok}/${recent.length}` : '-';
}

setInterval(() => { if (currentScreen === 'home') renderHome(); }, 15000);

/* ===== タイマー(壁時計方式: 経過 = (停止時刻 or 現在) - t0) ===== */

let run = loadJson(RUN_KEY, null); // { t0, pausedAt, marks: [累積ms], alerted: [bool] }
let rafId = 0;
let wakeLock = null;

const elapsedMs = () => (run.pausedAt ?? Date.now()) - run.t0;

function startRun() {
  unlockAudio();
  run = { t0: Date.now(), pausedAt: null, marks: [], alerted: [] };
  saveJson(RUN_KEY, run);
  enterRun();
}

function enterRun() {
  go('run');
  const n = store.records.length + 1;
  $('run-attempt').textContent = `${n}回目`;
  requestWakeLock();
  renderRunStatic();
  cancelAnimationFrame(rafId);
  tick();
}

function renderRunStatic() {
  const idx = run.marks.length;
  $('run-seg-name').textContent = tasks()[idx].name;
  $('run-seg-target').textContent = `${tasks()[idx].targetMin}分`;
  $('btn-split').textContent = idx === tasks().length - 1 ? 'ゴール！ 🏁' : `${tasks()[idx].name} 完了 →`;
  $('btn-pause').textContent = run.pausedAt ? '▶ 再開' : '⏸ 一時停止';
  $('run').classList.toggle('paused', !!run.pausedAt);
}

function tick() {
  if (!run || currentScreen !== 'run') return;
  const idx = run.marks.length;
  const total = elapsedMs() / 1000;
  const segStart = idx ? run.marks[idx - 1] / 1000 : 0;
  const seg = total - segStart;
  const target = targetSecOf(idx);
  const over = seg > target;

  const pb = pbRecord();
  const pbCum = pb ? cumulative(pb.splits) : null;
  const vsPb = pbCum ? total - pbCum[idx] : null;

  const totalEl = $('run-total');
  totalEl.querySelector('.main').textContent = fmtRta(total);
  totalEl.querySelector('.cs').textContent = fmtCentis(total);
  totalEl.classList.toggle('behind', vsPb != null && vsPb > 0);

  const segEl = $('run-seg');
  segEl.textContent = fmtRta(seg);
  segEl.classList.toggle('over', over);
  const fill = $('run-progress');
  fill.style.width = Math.min(100, (seg / target) * 100) + '%';
  fill.classList.toggle('over', over);

  const vsEl = $('run-vs-pb');
  vsEl.textContent = vsPb == null ? '--' : fmtDelta(vsPb);
  vsEl.className = vsPb == null ? '' : vsPb <= 0 ? 'ahead' : 'behind';

  // 就寝予想 = 現在 + 今のタスクの残り目標 + 未着手タスクの目標
  let restSec = Math.max(0, target - seg);
  for (let i = idx + 1; i < tasks().length; i++) restSec += targetSecOf(i);
  const bedMs = Date.now() + restSec * 1000;
  const bedEl = $('run-bed');
  bedEl.textContent = fmtClock(bedMs);
  bedEl.className = nightMinutes(bedMs) <= targetBedMinutes() ? 'ahead' : 'behind';

  renderSplits($('run-splits'), liveSplits(total), pb, idx);

  if (over && !run.alerted[idx] && !run.pausedAt) {
    run.alerted[idx] = true;
    saveJson(RUN_KEY, run);
    if (store.settings.sound) alarm();
  }

  rafId = requestAnimationFrame(tick);
}

function liveSplits(totalSec) {
  const out = [];
  let prev = 0;
  tasks().forEach((t, i) => {
    if (i < run.marks.length) {
      out.push({ id: t.id, name: t.name, sec: (run.marks[i] - prev) / 1000, targetSec: t.targetMin * 60 });
      prev = run.marks[i];
    } else if (i === run.marks.length) {
      out.push({ id: t.id, name: t.name, sec: totalSec - prev / 1000, targetSec: t.targetMin * 60, live: true });
    } else {
      out.push({ id: t.id, name: t.name, sec: null, targetSec: t.targetMin * 60 });
    }
  });
  return out;
}

/**
 * LiveSplit風スプリット表。
 * 差分 = 累積タイム - PBの累積(PBが無ければ目標の累積)。区間ベスト更新はゴールド表示。
 */
function renderSplits(el, splits, pb, currentIdx = -1, excludeId = null) {
  const others = store.records.filter((r) => r.id !== excludeId);
  const base = pb ? cumulative(pb.splits) : null;
  let cum = 0;
  let targetCum = 0;
  const rows = splits.map((s, i) => {
    targetCum += s.targetSec;
    const cmp = base ? base[i] : targetCum;
    if (s.sec == null) {
      return `<div class="split-row future"><span class="name">${esc(s.name)}</span>
        <span class="r">${fmtRta(s.targetSec)}</span><span class="r">${base ? fmtRta(base[i]) : '-'}</span></div>`;
    }
    cum += s.sec;
    const delta = cum - cmp;
    const best = bestSegment(i, others);
    const gold = !s.live && best != null && s.sec < best;
    const cls = gold ? 'd-gold' : delta <= 0 ? 'd-ahead' : 'd-behind';
    // 進行中の行は差分がマイナスの間は出さない(LiveSplit と同じく遅れ始めたら表示)
    const dText = s.live && delta <= 0 ? '' : fmtDelta(delta);
    return `<div class="split-row ${i === currentIdx ? 'current' : ''}">
      <span class="name">${esc(s.name)} <span class="muted small">${fmtRta(s.sec)}</span></span>
      <span class="r ${cls}">${dText}</span><span class="r time">${fmtRta(cum)}</span></div>`;
  });
  el.innerHTML = `<div class="split-head"><span>タスク</span><span class="r">${base ? 'PB差' : '目標差'}</span><span class="r">累積</span></div>` + rows.join('');
}

function splitNow() {
  if (!run || run.pausedAt) return;
  run.marks.push(elapsedMs());
  if (navigator.vibrate) navigator.vibrate(40);
  beep(880, 0.08);
  if (run.marks.length >= tasks().length) {
    finishRun();
  } else {
    saveJson(RUN_KEY, run);
    renderRunStatic();
  }
}

function togglePause() {
  if (!run) return;
  if (run.pausedAt) {
    run.t0 += Date.now() - run.pausedAt;
    run.pausedAt = null;
  } else {
    run.pausedAt = Date.now();
  }
  saveJson(RUN_KEY, run);
  renderRunStatic();
}

function abortRun() {
  if (!confirm('中断しますか？このランは記録されません。')) return;
  run = null;
  saveJson(RUN_KEY, null);
  releaseWakeLock();
  go('home');
}

let lastResultId = null;

function finishRun() {
  const finishedAt = Date.now();
  let prev = 0;
  const splits = tasks().map((t, i) => {
    const sec = (run.marks[i] - prev) / 1000;
    prev = run.marks[i];
    return { id: t.id, name: t.name, sec, targetSec: t.targetMin * 60 };
  });
  const totalSec = run.marks[run.marks.length - 1] / 1000;
  const prevPb = pbRecord();
  const record = {
    id: new Date(finishedAt).toISOString(),
    startedAt: finishedAt - (totalSec * 1000),
    finishedAt,
    splits,
    totalSec,
    targetTotalSec: targetTotalSec(),
    rank: computeRank(totalSec, targetTotalSec()).rank,
    bedAt: null,
  };
  const goldIdx = splits.map((s, i) => { const b = bestSegment(i); return b == null || s.sec < b; });
  store.records.push(record);
  persist();
  run = null;
  saveJson(RUN_KEY, null);
  releaseWakeLock();
  fanfare();
  lastResultId = record.id;
  showResult(record, prevPb, goldIdx);
}

function showResult(record, prevPb, goldIdx) {
  go('result');
  const r = computeRank(record.totalSec, record.targetTotalSec);
  $('result-rank').innerHTML = `<div class="rank-letter" style="color:${r.color}">${r.rank}</div>
    <div class="rank-title" style="color:${r.color}">${r.title}</div>`;
  $('result-total').innerHTML = `<span class="main">${fmtRta(record.totalSec)}</span><span class="cs">${fmtCentis(record.totalSec)}</span>`;

  const badges = [];
  if (!prevPb || record.totalSec < prevPb.totalSec) badges.push('<span class="badge">👑 NEW PB!</span>');
  if (prevPb) {
    goldIdx.forEach((g, i) => { if (g) badges.push(`<span class="badge">⭐ ${esc(record.splits[i].name)} 区間ベスト</span>`); });
  }
  const saved = record.targetTotalSec - record.totalSec;
  badges.push(`<span class="badge cyan">目標比 ${fmtDelta(-saved)}</span>`);
  $('result-badges').innerHTML = badges.join('');

  renderSplits($('result-splits'), record.splits, prevPb, -1, record.id);
  renderBedLine(record);
}

function renderBedLine(record) {
  const el = $('result-bed');
  const btn = $('btn-sleep');
  if (record.bedAt) {
    const ok = nightMinutes(record.bedAt) <= targetBedMinutes();
    el.innerHTML = `🌙 就寝 <span style="color:${ok ? 'var(--accent)' : 'var(--red)'}">${fmtClock(record.bedAt)}</span>` +
      (ok ? ' — 目標達成！おやすみなさい' : ` — 目標 ${store.settings.targetBed}`);
    btn.disabled = true;
    btn.textContent = '記録しました';
  } else {
    el.innerHTML = '<span class="muted small">歯みがきなどが終わって布団に入ったら押してください</span>';
    btn.disabled = false;
    btn.textContent = '🌙 おやすみ（就寝を記録）';
  }
}

function recordSleep() {
  const rec = store.records.find((r) => r.id === lastResultId);
  if (!rec) return;
  rec.bedAt = Date.now();
  persist();
  renderBedLine(rec);
}

$('btn-start').addEventListener('click', startRun);
$('btn-split').addEventListener('click', splitNow);
$('btn-pause').addEventListener('click', togglePause);
$('btn-abort').addEventListener('click', abortRun);
$('btn-sleep').addEventListener('click', recordSleep);
$('btn-result-home').addEventListener('click', () => go('home'));

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
  if (document.visibilityState === 'visible' && run && currentScreen === 'run') requestWakeLock();
});

/* ===== 音 ===== */

let audioCtx = null;

function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { audioCtx = null; }
}

function beep(freq, dur, when = 0) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime + when;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.frequency.value = freq;
  osc.type = 'square';
  gain.gain.setValueAtTime(0.08, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur);
}

function alarm() {
  if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
  [0, 0.25, 0.5].forEach((w) => beep(660, 0.18, w));
}

function fanfare() {
  [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.15, i * 0.12));
}

/* ===== 歴代記録 ===== */

let historyTab = 'total';
let listSort = 'newest';

function renderHistory() {
  const tabDefs = [
    ['total', '合計'],
    ...tasks().map((t, i) => [`seg${i}`, t.name]),
    ['bed', '就寝'],
    ['all', '全記録'],
  ];
  $('history-tabs').innerHTML = tabDefs.map(([k, label]) =>
    `<button class="tab" data-tab="${k}" aria-selected="${k === historyTab}">${esc(label)}</button>`).join('');

  const body = $('history-body');
  if (!store.records.length) {
    body.innerHTML = '<div class="empty">まだ記録がありません。<br>帰宅したら START！</div>';
    return;
  }

  if (historyTab === 'total' || historyTab.startsWith('seg')) {
    const i = historyTab === 'total' ? -1 : Number(historyTab.slice(3));
    const entries = store.records
      .map((r) => ({ r, sec: i < 0 ? r.totalSec : r.splits[i]?.sec }))
      .filter((e) => e.sec != null)
      .sort((a, b) => a.sec - b.sec);
    const target = i < 0 ? targetTotalSec() : targetSecOf(i);
    body.innerHTML = trendChart(store.records.slice(-30).map((r) => (i < 0 ? r.totalSec : r.splits[i]?.sec)), target, 'time') +
      `<div class="board">${entries.slice(0, 50).map((e, n) => boardRow(e.r, n + 1, fmtRta(e.sec))).join('')}</div>`;
  } else if (historyTab === 'bed') {
    const withBed = store.records.filter((r) => r.bedAt);
    const entries = [...withBed].reverse();
    body.innerHTML = trendChart(withBed.slice(-30).map((r) => nightMinutes(r.bedAt)), targetBedMinutes(), 'clock') +
      (entries.length
        ? `<div class="board">${entries.map((r) => {
          const ok = nightMinutes(r.bedAt) <= targetBedMinutes();
          return boardRow(r, ok ? '✓' : '✗', `<span style="color:${ok ? 'var(--accent)' : 'var(--red)'}">${fmtClock(r.bedAt)}</span>`, true);
        }).join('')}</div>`
        : '<div class="empty">就寝の記録はまだありません</div>');
  } else {
    const sorters = {
      newest: (a, b) => b.finishedAt - a.finishedAt,
      fastest: (a, b) => a.totalSec - b.totalSec,
      earlyBed: (a, b) => (a.bedAt ? nightMinutes(a.bedAt) : 1e9) - (b.bedAt ? nightMinutes(b.bedAt) : 1e9),
    };
    const sorted = [...store.records].sort(sorters[listSort]);
    body.innerHTML = `<div class="sort-row">${[['newest', '新しい順'], ['fastest', '合計タイム順'], ['earlyBed', '就寝が早い順']]
      .map(([k, l]) => `<button class="tab" data-sort="${k}" aria-selected="${k === listSort}">${l}</button>`).join('')}</div>
      <div class="board">${sorted.map((r) => boardRow(r, r.rank, fmtRta(r.totalSec))).join('')}</div>`;
  }
}

function boardRow(r, place, timeHtml, plainPlace = false) {
  const pcls = !plainPlace && typeof place === 'number' && place <= 3 ? ` p${place}` : '';
  const split = r.splits.map((s) => `${esc(s.name)} ${fmtRta(s.sec)}`).join(' / ');
  const bed = r.bedAt ? ` ・🌙${fmtClock(r.bedAt)}` : '';
  return `<button class="board-row${pcls}" data-record="${esc(r.id)}">
    <span class="place">${place}</span>
    <span><div>${fmtDate(r.finishedAt)}${bed}</div><div class="sub">${split}</div></span>
    <span class="time">${timeHtml}</span></button>`;
}

/** 直近の推移グラフ(目標ラインつき)。kind=time は秒、clock は正午からの分 */
function trendChart(values, target, kind) {
  const vals = values.map((v) => (v == null ? null : v));
  const real = vals.filter((v) => v != null);
  if (real.length < 2) return '';
  const W = 320, H = 120, P = 8;
  const lo = Math.min(...real, target);
  const hi = Math.max(...real, target);
  const span = hi - lo || 1;
  const x = (i) => P + (i * (W - 2 * P)) / (vals.length - 1);
  const y = (v) => H - P - ((v - lo) / span) * (H - 2 * P);
  const pts = vals.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean);
  const label = (v) => (kind === 'clock' ? `${pad(Math.floor(v / 60) % 24)}:${pad(Math.round(v % 60))}` : fmtRta(v));
  const dots = vals.map((v, i) => v == null ? '' :
    `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" fill="${v <= target ? 'var(--accent)' : 'var(--red)'}"/>`).join('');
  return `<div class="chart"><div class="muted small">直近${vals.length}回の推移(下ほど良い) — 点線: 目標 ${label(target)}</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="推移グラフ">
      <line x1="${P}" x2="${W - P}" y1="${y(target)}" y2="${y(target)}" stroke="var(--yellow)" stroke-dasharray="4 4"/>
      <polyline points="${pts.join(' ')}" fill="none" stroke="var(--text2)" stroke-width="1.5"/>
      ${dots}
    </svg></div>`;
}

$('history-tabs').addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (t) { historyTab = t.dataset.tab; renderHistory(); }
});

$('history-body').addEventListener('click', (e) => {
  const s = e.target.closest('[data-sort]');
  if (s) { listSort = s.dataset.sort; renderHistory(); return; }
  const row = e.target.closest('[data-record]');
  if (row) openDetail(row.dataset.record);
});

/* ===== 記録詳細 ===== */

let detailId = null;

function openDetail(id) {
  const r = store.records.find((x) => x.id === id);
  if (!r) return;
  detailId = id;
  const others = store.records.filter((x) => x.id !== id && x.finishedAt < r.finishedAt);
  const rank = computeRank(r.totalSec, r.targetTotalSec);
  const bed = r.bedAt ? `🌙 就寝 ${fmtClock(r.bedAt)}` : '就寝の記録なし';
  $('detail-body').innerHTML = `<div class="detail-title">${fmtDate(r.finishedAt)}
      <span style="color:${rank.color}"> ランク ${rank.rank}</span></div>
    <div class="muted small" style="margin-bottom:8px">合計 ${fmtRta(r.totalSec)} ・ 目標 ${fmtRta(r.targetTotalSec)} ・ ${bed}</div>
    <div id="detail-splits" class="splits"></div>
    <div class="muted small" style="margin-top:6px">差分はこの記録より前の PB との比較です</div>`;
  renderSplits($('detail-splits'), r.splits, pbRecord(others), -1, id);
  $('detail').showModal();
}

$('btn-detail-close').addEventListener('click', () => $('detail').close());
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
  f.targetBed.value = store.settings.targetBed;
  f.sound.checked = store.settings.sound;
  tasks().forEach((t, i) => {
    f[`name${i}`].value = t.name;
    f[`target${i}`].value = t.targetMin;
  });
}

$('settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  store.settings.targetBed = f.targetBed.value;
  store.settings.sound = f.sound.checked;
  tasks().forEach((t, i) => {
    t.name = f[`name${i}`].value.trim() || t.name;
    t.targetMin = Math.max(1, Number(f[`target${i}`].value) || t.targetMin);
  });
  persist();
  go('home');
});

$('btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  const d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `oyasumi-rta-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('input-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const incoming = Array.isArray(data.records) ? data.records : [];
    const valid = incoming.filter((r) => r && r.id && Array.isArray(r.splits) && typeof r.totalSec === 'number');
    const known = new Set(store.records.map((r) => r.id));
    const added = valid.filter((r) => !known.has(r.id));
    store.records.push(...added);
    persist();
    alert(`${added.length}件の記録を読み込みました`);
  } catch {
    alert('読み込めませんでした。書き出したJSONファイルを選んでください。');
  }
});

$('btn-clear').addEventListener('click', () => {
  if (!confirm('すべての記録を削除します。元に戻せません。よろしいですか？')) return;
  store.records = [];
  persist();
  go('home');
});

/* ===== 起動 ===== */

if (run && Array.isArray(run.marks) && run.marks.length < tasks().length) {
  enterRun(); // リロードやアプリ再起動でもラン継続
} else {
  run = null;
  saveJson(RUN_KEY, null);
  go('home');
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
