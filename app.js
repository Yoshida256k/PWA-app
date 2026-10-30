'use strict';

/* ===== 保存 ===== */

const STORE_KEY = 'oyasumi_rta_v1';
const RUN_KEY = 'oyasumi_rta_run_v1';
const MAX_RECORDS = 1000;

const DEFAULT_SETTINGS = {
  targetBed: '22:45',
  sound: true,
  firstTask: 'task0',
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
  const records = Array.isArray(data.records) ? data.records : [];
  // 2つ目のタスクは寝る直前まで(ゴール = 就寝)。就寝を押し忘れた古い記録はゴール時刻で補う
  for (const r of records) if (!r.bedAt) r.bedAt = r.finishedAt;
  return { settings, records };
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

/** 記録が属する日付 "YYYY-MM-DD"。深夜4時までは前日扱い(夜更かししても「その日」の記録になる) */
function dayKeyOf(ms) {
  const d = new Date(ms - 4 * 3600 * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* ===== 記録の集計(タスクは順番ではなく id で扱う) ===== */

const tasks = () => store.settings.tasks;
const taskById = (id) => tasks().find((t) => t.id === id) || tasks()[0];
const targetTotalSec = () => tasks().reduce((s, t) => s + t.targetMin * 60, 0);
const segOf = (r, id) => r.splits.find((s) => s.id === id)?.sec;

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

const rankColor = (rank) => ({ S: 'var(--yellow)', A: 'var(--accent)', B: 'var(--cyan)' }[rank] || 'var(--muted)');

function pbRecord(records = store.records) {
  let best = null;
  for (const r of records) if (!best || r.totalSec < best.totalSec) best = r;
  return best;
}

function bestSegment(id, records = store.records) {
  let best = null;
  for (const r of records) {
    const s = segOf(r, id);
    if (s != null && (best == null || s < best)) best = s;
  }
  return best;
}

/** PB の区間タイムを、今回の順番(ids)に並べ替えて累積したもの。最後の値は PB の合計と一致する */
function pbCumulative(pb, ids) {
  let c = 0;
  return ids.map((id) => (c += segOf(pb, id) ?? taskById(id).targetMin * 60));
}

/* 期間別PB: 記録の日付(dayKeyOf)で今月・今年を判定する */
const recordDay = (r) => dayKeyOf(r.startedAt ?? r.finishedAt);
const monthPrefix = (y, m) => `${y}-${pad(m + 1)}-`; // m: 0-11
const recordsIn = (prefix, records = store.records) => records.filter((r) => recordDay(r).startsWith(prefix));

/** ある時刻が属する月・年のプレフィックス */
function periodsAt(ms) {
  const [y, m] = dayKeyOf(ms).split('-').map(Number);
  return { month: monthPrefix(y, m - 1), year: `${y}-` };
}

/** ホーム・計測中に比べる「今月のPB」の対象記録(計測中はスタートした月) */
const thisMonthRecords = (ms = Date.now()) => recordsIn(periodsAt(ms).month);

/* ===== 画面遷移 ===== */

const $ = (id) => document.getElementById(id);
let currentScreen = 'home';

function go(name) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== name;
  currentScreen = name;
  if (name === 'home') renderHome();
  if (name === 'history') renderHistory();
  if (name === 'settings') renderSettings();
  if (name === 'calendar') renderCalendar();
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-go]');
  if (btn) go(btn.dataset.go);
});

/* ===== ホーム ===== */

function orderFrom(firstId) {
  const first = taskById(firstId);
  return [first.id, ...tasks().filter((t) => t.id !== first.id).map((t) => t.id)];
}

function renderHome() {
  $('home-now').textContent = fmtClock(Date.now());
  $('home-target-bed').textContent = store.settings.targetBed;

  const monthRecs = thisMonthRecords();
  const pb = pbRecord(monthRecs);
  const planSec = pb ? pb.totalSec : targetTotalSec();
  const endMs = Date.now() + planSec * 1000;
  const margin = targetBedMinutes() - nightMinutes(endMs);
  const fc = $('home-forecast');
  fc.className = 'forecast ' + (margin >= 0 ? 'ok' : 'ng');
  fc.textContent = `今から${pb ? '今月PBペース' : '目標ペース'}で終わると ${fmtClock(endMs)} ` +
    (margin >= 0 ? `(あと${margin}分 余裕)` : `(${-margin}分 オーバー)`);

  const rows = tasks().map((t) => {
    const b = bestSegment(t.id, monthRecs);
    return `<div class="pb-item"><span class="name">${esc(t.name)}</span>
      <span class="muted small">目標 ${t.targetMin}分 / 今月PB</span>
      <span class="pb">${b == null ? '--:--' : fmtRta(b)}</span></div>`;
  });
  rows.push(`<div class="pb-item total"><span class="name">合計</span>
    <span class="muted small">目標 ${fmtRta(targetTotalSec())} / 今月PB</span>
    <span class="pb">${pb ? fmtRta(pb.totalSec) : '--:--'}</span></div>`);
  $('home-pbs').innerHTML = rows.join('');

  $('home-attempts').textContent = store.records.length;
  const recent = store.records.filter((r) => r.bedAt).slice(-7);
  const ok = recent.filter((r) => nightMinutes(r.bedAt) <= targetBedMinutes()).length;
  $('home-bed-ok').textContent = recent.length ? `${ok}/${recent.length}` : '-';

  $('order-select').innerHTML = tasks().map((t) => {
    const label = orderFrom(t.id).map((id) => esc(taskById(id).name)).join(' → ');
    return `<button class="order-btn" role="radio" data-first="${t.id}"
      aria-checked="${t.id === taskById(store.settings.firstTask).id}">${label}</button>`;
  }).join('');
}

$('order-select').addEventListener('click', (e) => {
  const b = e.target.closest('[data-first]');
  if (!b) return;
  store.settings.firstTask = b.dataset.first;
  persist();
  renderHome();
});

setInterval(() => { if (currentScreen === 'home') renderHome(); }, 15000);

/* ===== タイマー(壁時計方式: 経過 = (停止時刻 or 現在) - t0) ===== */

// { t0, startedAt, pausedAt, marks: [累積ms], alerted: [bool], order: [taskId] }
// t0 は一時停止のたびにずらす計算用。startedAt は玄関を開けた実際の時刻
let run = loadJson(RUN_KEY, null);
let rafId = 0;
let wakeLock = null;

const elapsedMs = () => (run.pausedAt ?? Date.now()) - run.t0;
const runTask = (k) => taskById(run.order[k]);

function startRun() {
  unlockAudio();
  const now = Date.now();
  run = { t0: now, startedAt: now, pausedAt: null, marks: [], alerted: [], order: orderFrom(store.settings.firstTask) };
  saveJson(RUN_KEY, run);
  enterRun();
}

function enterRun() {
  go('run');
  $('run-attempt').textContent = `${store.records.length + 1}回目`;
  requestWakeLock();
  renderRunStatic();
  cancelAnimationFrame(rafId);
  tick();
}

function renderRunStatic() {
  const idx = run.marks.length;
  const t = runTask(idx);
  $('run-seg-name').textContent = t.name;
  $('run-seg-target').textContent = `${t.targetMin}分`;
  $('btn-split').textContent = idx === run.order.length - 1 ? 'おやすみゴール 🌙' : `${t.name} 完了 →`;
  $('btn-pause').textContent = run.pausedAt ? '▶ 再開' : '⏸ 一時停止';
  $('run').classList.toggle('paused', !!run.pausedAt);
}

function tick() {
  if (!run || currentScreen !== 'run') return;
  const idx = run.marks.length;
  const total = elapsedMs() / 1000;
  const segStart = idx ? run.marks[idx - 1] / 1000 : 0;
  const seg = total - segStart;
  const target = runTask(idx).targetMin * 60;
  const over = seg > target;

  const monthRecs = thisMonthRecords(run.t0);
  const pb = pbRecord(monthRecs);
  const vsPb = pb ? total - pbCumulative(pb, run.order)[idx] : null;

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
  for (let k = idx + 1; k < run.order.length; k++) restSec += runTask(k).targetMin * 60;
  const bedMs = Date.now() + restSec * 1000;
  const bedEl = $('run-bed');
  bedEl.textContent = fmtClock(bedMs);
  bedEl.className = nightMinutes(bedMs) <= targetBedMinutes() ? 'ahead' : 'behind';

  renderSplits($('run-splits'), liveSplits(total), pb, monthRecs, idx);

  if (over && !run.alerted[idx] && !run.pausedAt) {
    run.alerted[idx] = true;
    saveJson(RUN_KEY, run);
    if (store.settings.sound) alarm();
  }

  rafId = requestAnimationFrame(tick);
}

function liveSplits(totalSec) {
  let prev = 0;
  return run.order.map((id, k) => {
    const t = taskById(id);
    const base = { id, name: t.name, targetSec: t.targetMin * 60 };
    if (k < run.marks.length) {
      const sec = (run.marks[k] - prev) / 1000;
      prev = run.marks[k];
      return { ...base, sec };
    }
    if (k === run.marks.length) return { ...base, sec: totalSec - prev / 1000, live: true };
    return { ...base, sec: null };
  });
}

/**
 * LiveSplit風スプリット表。
 * 差分 = 累積タイム - PBの累積(PBが無ければ目標の累積)。
 * pool(比較対象の記録)の区間ベストを更新した行はゴールド表示。
 */
function renderSplits(el, splits, pb, pool, currentIdx = -1) {
  const base = pb ? pbCumulative(pb, splits.map((s) => s.id)) : null;
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
    const best = bestSegment(s.id, pool);
    const gold = !s.live && best != null && s.sec < best;
    const cls = gold ? 'd-gold' : delta <= 0 ? 'd-ahead' : 'd-behind';
    // 進行中の行は差分がマイナスの間は出さない(LiveSplit と同じく遅れ始めたら表示)
    const dText = s.live && delta <= 0 ? '' : fmtDelta(delta);
    return `<div class="split-row ${i === currentIdx ? 'current' : ''}">
      <span class="name">${esc(s.name)} <span class="muted small">${fmtRta(s.sec)}</span></span>
      <span class="r ${cls}">${dText}</span><span class="r time">${fmtRta(cum)}</span></div>`;
  });
  el.innerHTML = `<div class="split-head"><span>タスク</span><span class="r">${base ? (el.dataset.pbLabel || 'PB差') : '目標差'}</span><span class="r">累積</span></div>` + rows.join('');
}

function splitNow() {
  if (!run || run.pausedAt) return;
  run.marks.push(elapsedMs());
  if (navigator.vibrate) navigator.vibrate(40);
  beep(880, 0.08);
  if (run.marks.length >= run.order.length) {
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

// ゴール直後のリザルト表示用(ひとこと入力 → リザルト)
let lastResult = null; // { id, monthRecs, pbBadge, goldIds }

/** 更新したいちばん大きな期間のPBバッジ(歴代 > 今年 > 今月)。何も更新していなければ null */
function pbBadgeFor(totalSec, records, periods) {
  const tiers = [
    ['👑', '歴代', records],
    ['🏆', '今年', recordsIn(periods.year, records)],
    ['⭐', '今月', recordsIn(periods.month, records)],
  ];
  for (const [icon, label, recs] of tiers) {
    const prev = pbRecord(recs);
    if (!prev) return `${icon} ${label}の初記録!`;
    if (totalSec < prev.totalSec) return `${icon} ${label}のPB更新!`;
  }
  return null;
}

function finishRun() {
  const finishedAt = Date.now();
  const splits = liveSplits(0).map(({ live, ...s }) => s);
  const totalSec = run.marks[run.marks.length - 1] / 1000;
  const startedAt = run.startedAt ?? finishedAt - totalSec * 1000;
  // 今月・今年はスタート時刻で判定(月末の深夜をまたいでも、始めた日の月の記録になる)
  const periods = periodsAt(startedAt);
  const monthRecs = recordsIn(periods.month);
  const pbBadge = pbBadgeFor(totalSec, store.records, periods);
  const goldIds = splits.filter((s) => { const b = bestSegment(s.id, monthRecs); return b != null && s.sec < b; }).map((s) => s.id);
  const record = {
    id: new Date(finishedAt).toISOString(),
    startedAt,
    finishedAt,
    splits,
    totalSec,
    targetTotalSec: targetTotalSec(),
    rank: computeRank(totalSec, targetTotalSec()).rank,
    bedAt: finishedAt, // 2つ目のタスクは寝る直前までなので、ゴール = 就寝
    comment: '',
  };
  store.records.push(record);
  persist();
  run = null;
  saveJson(RUN_KEY, null);
  releaseWakeLock();
  fanfare();
  lastResult = { id: record.id, monthRecs, pbBadge, goldIds };

  go('comment');
  $('comment-total').innerHTML = `<span class="main">${fmtRta(totalSec)}</span><span class="cs">${fmtCentis(totalSec)}</span>`;
  $('comment-input').value = '';
}

function commentDone() {
  const rec = store.records.find((r) => r.id === lastResult?.id);
  if (!rec) { go('home'); return; }
  rec.comment = $('comment-input').value.trim();
  persist();
  showResult(rec, lastResult);
}

function showResult(record, { monthRecs, pbBadge, goldIds }) {
  go('result');
  const r = computeRank(record.totalSec, record.targetTotalSec);
  $('result-rank').innerHTML = `<div class="rank-letter" style="color:${r.color}">${r.rank}</div>
    <div class="rank-title" style="color:${r.color}">${r.title}</div>`;
  $('result-total').innerHTML = `<span class="main">${fmtRta(record.totalSec)}</span><span class="cs">${fmtCentis(record.totalSec)}</span>`;
  $('result-times').innerHTML = `<div class="muted small">${recordDate(record)}</div>🚪 ${fmtClock(record.startedAt)} スタート → 🌙 ${fmtClock(record.finishedAt)} ゴール`;

  const badges = [];
  if (pbBadge) badges.push(`<span class="badge">${pbBadge}</span>`);
  for (const id of goldIds) badges.push(`<span class="badge">⚡ ${esc(taskById(id).name)} 今月の区間ベスト</span>`);
  const saved = record.targetTotalSec - record.totalSec;
  badges.push(`<span class="badge cyan">目標比 ${fmtDelta(-saved)}</span>`);
  $('result-badges').innerHTML = badges.join('');

  renderSplits($('result-splits'), record.splits, pbRecord(monthRecs), monthRecs);
  $('result-comment').innerHTML = record.comment ? `<div class="comment-box">💬 ${esc(record.comment)}</div>` : '';
  renderBedLine(record);
}

function renderBedLine(record) {
  const diff = targetBedMinutes() - nightMinutes(record.bedAt);
  const ok = diff >= 0;
  $('result-bed').innerHTML = `🌙 就寝 <span style="color:${ok ? 'var(--accent)' : 'var(--red)'}">${fmtClock(record.bedAt)}</span>` +
    (ok ? ` — 目標より${diff}分早い！おやすみなさい` : ` — 目標 ${store.settings.targetBed} から${-diff}分オーバー`);
}

$('btn-start').addEventListener('click', startRun);
$('btn-split').addEventListener('click', splitNow);
$('btn-pause').addEventListener('click', togglePause);
$('btn-abort').addEventListener('click', abortRun);
$('btn-comment-done').addEventListener('click', commentDone);
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
    ...tasks().map((t) => [`seg:${t.id}`, t.name]),
    ['bed', '就寝'],
    ['all', '全記録'],
  ];
  $('history-tabs').innerHTML = tabDefs.map(([k, label]) =>
    `<button class="tab" data-tab="${k}" aria-selected="${k === historyTab}">${esc(label)}</button>`).join('');

  const body = $('history-body');
  if (!store.records.length) {
    body.innerHTML = '<div class="empty">まだ記録がありません。<br>玄関を開けたら START！</div>';
    return;
  }

  if (historyTab === 'total' || historyTab.startsWith('seg:')) {
    const id = historyTab === 'total' ? null : historyTab.slice(4);
    const valueOf = (r) => (id ? segOf(r, id) : r.totalSec);
    const entries = store.records
      .map((r) => ({ r, sec: valueOf(r) }))
      .filter((e) => e.sec != null)
      .sort((a, b) => a.sec - b.sec);
    const target = id ? taskById(id).targetMin * 60 : targetTotalSec();
    body.innerHTML = trendChart(store.records.slice(-30).map(valueOf), target, 'time') +
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

/** 「🚪21:22 → 🏁23:09」。就寝をゴールと別に記録した古い記録は 🌙 も付ける */
function timeSpan(r) {
  const start = r.startedAt ?? r.finishedAt - r.totalSec * 1000;
  let text = `🚪${fmtClock(start)} → 🏁${fmtClock(r.finishedAt)}`;
  if (r.bedAt && Math.abs(r.bedAt - r.finishedAt) > 60 * 1000) text += ` ・🌙${fmtClock(r.bedAt)}`;
  return text;
}

const recordDate = (r) => fmtDate(r.startedAt ?? r.finishedAt).split(' ')[0];

function boardRow(r, place, timeHtml, plainPlace = false) {
  const pcls = !plainPlace && typeof place === 'number' && place <= 3 ? ` p${place}` : '';
  const split = r.splits.map((s) => `${esc(s.name)} ${fmtRta(s.sec)}`).join(' → ');
  const comment = r.comment ? `<div class="sub">💬 ${esc(r.comment)}</div>` : '';
  return `<button class="board-row${pcls}" data-record="${esc(r.id)}">
    <span class="place">${place}</span>
    <span><div>${recordDate(r)} ${timeSpan(r)}</div><div class="sub">${split}</div>${comment}</span>
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

/* ===== カレンダー ===== */

let calYear = null;
let calMonth = null; // 0-11
let calSelected = null; // "YYYY-MM-DD"

function renderCalendar() {
  const todayKey = dayKeyOf(Date.now());
  if (calYear == null) {
    const [y, m] = todayKey.split('-').map(Number);
    calYear = y;
    calMonth = m - 1;
    calSelected = todayKey;
  }
  $('cal-title').textContent = `${calYear}年${calMonth + 1}月`;
  const monthRecs = recordsIn(monthPrefix(calYear, calMonth));
  const monthPb = pbRecord(monthRecs);
  renderPeriodPbs(monthRecs, recordsIn(`${calYear}-`));

  const byDay = new Map();
  for (const r of store.records) {
    const k = dayKeyOf(r.startedAt ?? r.finishedAt);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(r);
  }

  const cells = ['日', '月', '火', '水', '木', '金', '土'].map((w, i) =>
    `<div class="cal-dow${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}">${w}</div>`);
  const firstDow = new Date(calYear, calMonth, 1).getDay();
  const days = new Date(calYear, calMonth + 1, 0).getDate();
  for (let i = 0; i < firstDow; i++) cells.push('<div class="cal-cell blank"></div>');
  for (let d = 1; d <= days; d++) {
    const key = `${calYear}-${pad(calMonth + 1)}-${pad(d)}`;
    const recs = byDay.get(key) || [];
    // その日のベスト(最速)のランクと、最後の就寝時刻を表示
    const best = pbRecord(recs);
    const bed = [...recs].reverse().find((r) => r.bedAt)?.bedAt;
    const bedOk = bed && nightMinutes(bed) <= targetBedMinutes();
    const cls = ['cal-cell', key === todayKey ? 'today' : '', key === calSelected ? 'selected' : ''].join(' ');
    const crown = monthPb && recs.includes(monthPb) ? '<span class="crown" aria-label="今月のPB">👑</span>' : '';
    cells.push(`<button class="${cls}" data-day="${key}">
      ${crown}<span class="d">${d}</span>
      ${best ? `<span class="rk" style="color:${rankColor(best.rank)}">${best.rank}</span>` : ''}
      ${bed ? `<span class="bt" style="color:${bedOk ? 'var(--accent)' : 'var(--red)'}">${fmtClock(bed)}</span>` : ''}
    </button>`);
  }
  $('cal-grid').innerHTML = cells.join('');

  const [, sm, sd] = calSelected.split('-').map(Number);
  const recs = (byDay.get(calSelected) || []).slice().sort((a, b) => a.finishedAt - b.finishedAt);
  $('cal-day').innerHTML = `<h3>${sm}/${sd} のリザルト</h3>` + (recs.length
    ? `<div class="board">${recs.map((r) => boardRow(r, r.rank, fmtRta(r.totalSec))).join('')}</div>`
    : '<div class="empty">この日の記録はありません</div>');
}

/** 表示中の月・年のPB(ご飯・お風呂の区間ベストと合計)。タップでその記録の詳細を開く */
function renderPeriodPbs(monthRecs, yearRecs) {
  const bestRec = (recs, id) => {
    let best = null;
    for (const r of recs) {
      const v = id ? segOf(r, id) : r.totalSec;
      if (v != null && (!best || v < best.v)) best = { r, v };
    }
    return best;
  };
  const cell = (b) => (b
    ? `<button class="pb-cell" data-record="${esc(b.r.id)}"><b>${fmtRta(b.v)}</b><span>${fmtDate(b.r.finishedAt).split(' ')[0]}</span></button>`
    : '<span class="pb-cell empty-cell">--:--</span>');
  const rows = [...tasks().map((t) => [esc(t.name), t.id]), ['合計', null]].map(([name, id]) =>
    `<div class="pb-row${id ? '' : ' total'}"><span class="pb-name">${name}</span>${cell(bestRec(monthRecs, id))}${cell(bestRec(yearRecs, id))}</div>`);
  $('cal-pb').innerHTML = `<div class="pb-row head"><span></span><span>⭐ ${calMonth + 1}月のPB</span><span>🏆 ${calYear}年のPB</span></div>` + rows.join('');
}

function moveMonth(diff) {
  const d = new Date(calYear, calMonth + diff, 1);
  calYear = d.getFullYear();
  calMonth = d.getMonth();
  renderCalendar();
}

$('cal-prev').addEventListener('click', () => moveMonth(-1));
$('cal-next').addEventListener('click', () => moveMonth(1));
$('cal-grid').addEventListener('click', (e) => {
  const c = e.target.closest('[data-day]');
  if (c) { calSelected = c.dataset.day; renderCalendar(); }
});
$('cal-pb').addEventListener('click', (e) => {
  const b = e.target.closest('[data-record]');
  if (b) openDetail(b.dataset.record);
});
$('cal-day').addEventListener('click', (e) => {
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
  $('detail-body').innerHTML = `<div class="detail-title">${recordDate(r)} ${timeSpan(r)}
      <span style="color:${rank.color}"> ランク ${rank.rank}</span></div>
    <div class="muted small" style="margin-bottom:8px">合計 ${fmtRta(r.totalSec)} ・ 目標 ${fmtRta(r.targetTotalSec)}</div>
    <div id="detail-splits" class="splits"></div>
    <div class="muted small" style="margin-top:6px">差分はこの記録より前の PB との比較です</div>`;
  renderSplits($('detail-splits'), r.splits, pbRecord(others), others);
  $('detail-comment').value = r.comment || '';
  $('detail').showModal();
}

function refreshAfterDetail() {
  if (currentScreen === 'history') renderHistory();
  if (currentScreen === 'calendar') renderCalendar();
}

$('btn-detail-close').addEventListener('click', () => $('detail').close());
$('btn-detail-save').addEventListener('click', () => {
  const r = store.records.find((x) => x.id === detailId);
  if (!r) return;
  r.comment = $('detail-comment').value.trim();
  persist();
  $('detail').close();
  refreshAfterDetail();
});
$('btn-detail-delete').addEventListener('click', () => {
  if (!confirm('この記録を削除しますか？')) return;
  store.records = store.records.filter((r) => r.id !== detailId);
  persist();
  $('detail').close();
  refreshAfterDetail();
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
  a.download = `hayo-nete-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
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

if (run && Array.isArray(run.marks)) {
  // 旧バージョンで始めたラン(順番なし)はご飯→お風呂の順として扱う
  if (!Array.isArray(run.order)) run.order = tasks().map((t) => t.id);
}
if (run && Array.isArray(run.marks) && run.marks.length < run.order.length) {
  enterRun(); // リロードやアプリ再起動でもラン継続
} else {
  run = null;
  saveJson(RUN_KEY, null);
  go('home');
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
