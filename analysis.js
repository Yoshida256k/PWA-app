'use strict';

/*
 * 分析画面(📊)と、歴代記録タブの推移グラフ。
 * app.js の store・書式関数を使う(app.js の後に読み込むこと)。
 * グラフは依存なしの SVG。値はすべて「表で見る」でも確認できる。
 */

/* ===== 色(dataviz の検証スクリプトで #1e1e1e 上の2色を検証済み) ===== */

const TASK_COLOR = { task0: '#3987e5', task1: '#d95926' }; // ご飯=青 / お風呂=オレンジ
const C = {
  surface: '#1e1e1e',
  grid: '#2c2c2c',
  axis: '#888888',
  ink: '#cccccc',
  good: '#00e676',
  bad: '#ff5252',
  target: '#ffd600',
  avg: '#00e5ff',
  other: '#5c5c5c',
};
const taskColor = (id) => TASK_COLOR[id] || C.other;

/* ===== 時刻・日付の小道具 ===== */

/** 夜の時刻を「その日0時からの分」(正午より前は +24h)で、秒まで含めて返す */
function clockMin(ms) {
  const d = new Date(ms);
  const m = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  return m < 12 * 60 ? m + 24 * 60 : m;
}

function fmtMinClock(min) {
  const t = Math.round(min);
  return `${pad(Math.floor(t / 60) % 24)}:${pad(t % 60)}`;
}

function fmtMinDur(min) {
  const t = Math.round(Math.abs(min));
  return t >= 60 ? `${Math.floor(t / 60)}時間${pad(t % 60)}分` : `${t}分`;
}

function fmtSigned(min) {
  const r = Math.round(min);
  if (r === 0) return '±0分';
  return (r > 0 ? '+' : '−') + fmtMinDur(r);
}

function dayIndex(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 864e5);
}

function keyLabel(key, withDow = true) {
  const [y, m, d] = key.split('-').map(Number);
  const w = '日月火水木金土'[new Date(y, m - 1, d).getDay()];
  return withDow ? `${m}/${d}(${w})` : `${m}/${d}`;
}

/** 時間の軸目盛り: 1つの軸の中で表記をそろえるため、常に「90分」形式 */
const fmtAxisMin = (min) => `${Math.round(min)}分`;

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/* ===== 集計 ===== */

/**
 * 記録を「1晩1件」にまとめる。同じ日に複数回あるときは最後にゴールした記録(= 実際の就寝)。
 * 就寝の遅れ(目標比)は次の4つに正確に分解できる:
 *   帰宅の遅れ = 帰宅時刻 - (目標就寝 - 目標合計)   … 目標ペースで間に合う帰宅時刻との差
 *   各タスクの超過 = 実際 - 目標(記録時点の目標)
 *   その他 = 就寝 - (帰宅 + 合計タイム)        … 一時停止など
 */
function buildNights(records = store.records) {
  const byDay = new Map();
  for (const r of records) {
    const key = dayKeyOf(r.startedAt ?? r.finishedAt);
    const prev = byDay.get(key);
    if (!prev || r.finishedAt > prev.finishedAt) byDay.set(key, r);
  }
  const T = targetBedMinutes();
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, r]) => {
      const startMin = clockMin(r.startedAt ?? r.finishedAt - r.totalSec * 1000);
      const bedAt = r.bedAt ?? r.finishedAt;
      const bedMin = clockMin(bedAt);
      const seg = {};
      const tgt = {};
      for (const s of r.splits) {
        seg[s.id] = s.sec / 60;
        tgt[s.id] = (s.targetSec ?? taskById(s.id).targetMin * 60) / 60;
      }
      const totalMin = r.totalSec / 60;
      const targetTotal = Object.values(tgt).reduce((a, b) => a + b, 0);
      const parts = { arrival: startMin - (T - targetTotal), other: bedMin - (startMin + totalMin) };
      for (const t of tasks()) parts[t.id] = (seg[t.id] ?? 0) - (tgt[t.id] ?? 0);
      return {
        key, r, idx: dayIndex(key), startMin, bedMin, totalMin, seg, tgt, targetTotal, parts,
        order: r.splits.map((s) => s.id),
        delay: bedMin - T,
        ok: nightMinutes(bedAt) <= T,
      };
    });
}

let anaPeriod = '30';

function periodOf(mode) {
  const todayKey = dayKeyOf(Date.now());
  const today = dayIndex(todayKey);
  if (mode === '7' || mode === '30') {
    const n = Number(mode);
    return { from: today - n + 1, to: today, prev: { from: today - 2 * n + 1, to: today - n }, prevLabel: `その前の${n}日` };
  }
  if (mode === 'month') {
    const [y, m] = todayKey.split('-').map(Number);
    const first = dayIndex(`${y}-${pad(m)}-01`);
    const pm = m === 1 ? 12 : m - 1;
    const py = m === 1 ? y - 1 : y;
    return { from: first, to: today, prev: { from: dayIndex(`${py}-${pad(pm)}-01`), to: first - 1 }, prevLabel: '先月' };
  }
  return { from: -Infinity, to: Infinity, prev: null, prevLabel: '' };
}

const inRange = (nights, p) => nights.filter((n) => n.idx >= p.from && n.idx <= p.to);

/* ===== ツールチップ(1つを使い回す) ===== */

const tip = document.createElement('div');
tip.className = 'viz-tip';
tip.hidden = true;
document.body.append(tip);

/** rows: [{ color?, value, label }]。値を強く、ラベルを控えめに */
function showTip(clientX, clientY, title, rows) {
  tip.replaceChildren();
  const h = document.createElement('div');
  h.className = 'viz-tip-title';
  h.textContent = title;
  tip.append(h);
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'viz-tip-row';
    const key = document.createElement('span');
    key.className = 'viz-tip-key';
    if (r.color) key.style.background = r.color;
    const v = document.createElement('b');
    v.textContent = r.value;
    const l = document.createElement('span');
    l.textContent = r.label;
    row.append(key, v, l);
    tip.append(row);
  }
  tip.hidden = false;
  const w = tip.offsetWidth;
  const hgt = tip.offsetHeight;
  tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, clientX - w / 2)) + 'px';
  const top = clientY - hgt - 16;
  tip.style.top = (top < 8 ? clientY + 18 : top) + 'px';
}

function hideTip() {
  tip.hidden = true;
}

document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.viz-svg')) hideTip();
});
window.addEventListener('scroll', hideTip, true);

/**
 * SVG にタップ/ホバーの選択を付ける。pick(x, y) は SVG 座標から選ぶ要素の番号(なければ -1)。
 * 選ばれた番号で onPick(i, event) を呼ぶ(ハイライト更新とツールチップ表示)。
 */
function bindPick(svg, W, pick, onPick) {
  const handle = (e) => {
    const rect = svg.getBoundingClientRect();
    const k = W / rect.width;
    const i = pick((e.clientX - rect.left) * k, (e.clientY - rect.top) * k);
    if (i < 0) { hideTip(); onPick(-1, e); return; }
    onPick(i, e);
  };
  svg.addEventListener('pointerdown', handle);
  svg.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') handle(e); });
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { hideTip(); onPick(-1, e); } });
}

/* ===== 軸のめもり ===== */

function niceTicks(lo, hi, candidates, maxTicks = 5) {
  const step = candidates.find((s) => (hi - lo) / s <= maxTicks) ?? candidates[candidates.length - 1];
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(v);
  return { step, ticks };
}

const svgOpen = (W, H, label) =>
  `<svg class="viz-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">`;

const plotWidth = (el) => Math.max(280, Math.round(el.clientWidth || 340));

/* ===== 折れ線(推移) ===== */

/**
 * pts: [{ x, v, label, ok?, avg? }] (x は日番号など、v は分)。
 * opts: { target, kind: 'clock'|'dur', title, tipRows(i) }
 */
function drawLine(el, pts, opts) {
  const W = plotWidth(el);
  const H = 190;
  const m = { l: 46, r: 14, t: 18, b: 24 };
  const vals = pts.map((p) => p.v).concat(pts.filter((p) => p.avg != null).map((p) => p.avg), [opts.target]);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const padV = Math.max(5, (hi - lo) * 0.08);
  lo -= padV;
  hi += padV;
  const cands = opts.kind === 'clock' ? [15, 30, 60, 120, 180] : [5, 10, 15, 30, 60, 120];
  const { ticks } = niceTicks(lo, hi, cands);
  const fmtV = opts.kind === 'clock' ? fmtMinClock : fmtAxisMin;
  const x0 = pts[0].x;
  const x1 = pts[pts.length - 1].x;
  const X = (x) => (x1 === x0 ? (m.l + W - m.r) / 2 : m.l + ((x - x0) / (x1 - x0)) * (W - m.l - m.r));
  const Y = (v) => H - m.b - ((v - lo) / (hi - lo)) * (H - m.t - m.b);

  let s = svgOpen(W, H, opts.title);
  for (const t of ticks) {
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="${C.grid}" stroke-width="1"/>
      <text x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end" class="viz-axis">${fmtV(t)}</text>`;
  }
  // x 軸ラベル: 最初・真ん中・最後
  const xIdx = [...new Set([0, Math.floor((pts.length - 1) / 2), pts.length - 1])];
  for (const i of xIdx) {
    const anchor = i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle';
    s += `<text x="${X(pts[i].x)}" y="${H - 6}" text-anchor="${pts.length === 1 ? 'middle' : anchor}" class="viz-axis">${esc(pts[i].label)}</text>`;
  }
  // 目標線
  s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(opts.target)}" y2="${Y(opts.target)}" stroke="${C.target}" stroke-width="1" stroke-dasharray="4 4"/>`;
  const path = (key) => pts.filter((p) => p[key] != null).map((p) => `${X(p.x).toFixed(1)},${Y(p[key]).toFixed(1)}`).join(' ');
  if (pts.some((p) => p.avg != null)) {
    s += `<polyline points="${path('avg')}" fill="none" stroke="${C.avg}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity=".85"/>`;
  }
  s += `<polyline points="${path('v')}" fill="none" stroke="${C.ink}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  s += `<line class="viz-cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="${C.axis}" stroke-width="1" visibility="hidden"/>`;
  pts.forEach((p, i) => {
    s += `<circle class="viz-dot" data-i="${i}" cx="${X(p.x).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="4"
      fill="${p.ok == null ? C.ink : p.ok ? C.good : C.bad}" stroke="${C.surface}" stroke-width="2"/>`;
  });
  s += '</svg>';
  el.innerHTML = s;

  const svg = el.querySelector('svg');
  const cross = svg.querySelector('.viz-cross');
  const dots = [...svg.querySelectorAll('.viz-dot')];
  const xs = pts.map((p) => X(p.x));
  bindPick(svg, W, (x) => {
    let best = -1;
    let bd = Infinity;
    xs.forEach((px, i) => { const d = Math.abs(px - x); if (d < bd) { bd = d; best = i; } });
    return best;
  }, (i, e) => {
    dots.forEach((d, k) => d.setAttribute('r', k === i ? 6 : 4));
    if (i < 0) { cross.setAttribute('visibility', 'hidden'); return; }
    cross.setAttribute('x1', xs[i]);
    cross.setAttribute('x2', xs[i]);
    cross.setAttribute('visibility', 'visible');
    const t = opts.tipRows(i);
    showTip(e.clientX, e.clientY, t.title, t.rows);
  });
}

/* ===== 夜のタイムライン ===== */

const TIMELINE_MAX = 31;

function drawTimeline(el, nights) {
  const rows = nights.slice(-TIMELINE_MAX).reverse(); // 新しい日が上
  const T = targetBedMinutes();
  const W = plotWidth(el);
  const rowH = 26;
  const m = { l: 62, r: 66, t: 22, b: 6 };
  const H = m.t + rows.length * rowH + m.b;
  const lo = Math.floor(Math.min(...rows.map((n) => n.startMin), ...rows.map((n) => T - n.targetTotal)) / 60) * 60;
  const hi = Math.ceil(Math.max(...rows.map((n) => n.bedMin), T) / 60) * 60;
  const X = (v) => m.l + ((v - lo) / (hi - lo)) * (W - m.l - m.r);

  let s = svgOpen(W, H, '夜のタイムライン');
  const hourStep = hi - lo > 6 * 60 ? 120 : 60;
  for (let v = lo; v <= hi; v += hourStep) {
    s += `<line x1="${X(v)}" x2="${X(v)}" y1="${m.t - 4}" y2="${H - m.b}" stroke="${C.grid}" stroke-width="1"/>
      <text x="${X(v)}" y="${m.t - 9}" text-anchor="middle" class="viz-axis">${fmtMinClock(v)}</text>`;
  }
  rows.forEach((n, i) => {
    const y = m.t + i * rowH;
    const cy = y + rowH / 2;
    s += `<rect class="viz-row" data-i="${i}" x="0" y="${y}" width="${W}" height="${rowH}" fill="transparent"/>`;
    s += `<text x="4" y="${cy + 4}" class="viz-label">${esc(keyLabel(n.key))}</text>`;
    let cur = n.startMin;
    n.order.forEach((id) => {
      const len = n.seg[id] ?? 0;
      const x1 = X(cur) + 1;
      const x2 = X(cur + len) - 1; // 区間のあいだに 2px のすき間
      if (x2 > x1) s += `<rect x="${x1}" y="${cy - 6}" width="${x2 - x1}" height="12" rx="3" fill="${taskColor(id)}"/>`;
      cur += len;
    });
    if (n.bedMin - cur > 1) { // 一時停止などで就寝が遅れた分
      s += `<rect x="${X(cur) + 1}" y="${cy - 2}" width="${Math.max(0, X(n.bedMin) - X(cur) - 1)}" height="4" rx="2" fill="${C.other}"/>`;
    }
    s += `<text x="${W - m.r + 6}" y="${cy + 4}" class="viz-label">${fmtMinClock(n.bedMin)}</text>
      <text x="${W - 2}" y="${cy + 4}" text-anchor="end" class="viz-mark" fill="${n.ok ? C.good : C.bad}">${n.ok ? '✓' : '✗'}</text>`;
  });
  s += `<line x1="${X(T)}" x2="${X(T)}" y1="${m.t - 4}" y2="${H - m.b}" stroke="${C.target}" stroke-width="1" stroke-dasharray="4 4"/>`;
  s += '<rect class="viz-hl" x="0" y="0" width="0" height="0" fill="rgba(255,255,255,.06)" pointer-events="none"/>';
  s += '</svg>';
  el.innerHTML = s;

  const svg = el.querySelector('svg');
  const hl = svg.querySelector('.viz-hl');
  bindPick(svg, W, (x, y) => {
    const i = Math.floor((y - m.t) / rowH);
    return i >= 0 && i < rows.length ? i : -1;
  }, (i, e) => {
    if (i < 0) { hl.setAttribute('width', 0); return; }
    hl.setAttribute('x', 0);
    hl.setAttribute('y', m.t + i * rowH);
    hl.setAttribute('width', W);
    hl.setAttribute('height', rowH);
    const n = rows[i];
    showTip(e.clientX, e.clientY, keyLabel(n.key), nightTipRows(n));
  });
}

function nightTipRows(n) {
  return [
    { value: fmtMinClock(n.startMin), label: '🚪 帰宅' },
    ...n.order.map((id) => ({
      color: taskColor(id),
      value: fmtMinDur(n.seg[id] ?? 0),
      label: `${taskById(id).name}(目標${fmtSigned(n.parts[id])})`,
    })),
    { value: fmtMinClock(n.bedMin), label: `🌙 就寝(目標${fmtSigned(n.delay)})` },
  ];
}

/* ===== 0 を中心にした横棒(遅れの原因・曜日別) ===== */

/** items: [{ label, v (分, + は遅れ), sub?, muted? }] */
function drawDiverging(el, items, title) {
  const W = plotWidth(el);
  const rowH = 34;
  const m = { l: 92, r: 70, t: 6, b: 6 };
  const H = m.t + items.length * rowH + m.b;
  const maxAbs = Math.max(5, ...items.map((it) => Math.abs(it.v ?? 0)));
  const mid = m.l + (W - m.l - m.r) / 2;
  const half = (W - m.l - m.r) / 2;
  const X = (v) => mid + (v / maxAbs) * half;

  let s = svgOpen(W, H, title);
  s += `<line x1="${mid}" x2="${mid}" y1="${m.t}" y2="${H - m.b}" stroke="${C.axis}" stroke-width="1"/>`;
  items.forEach((it, i) => {
    const y = m.t + i * rowH;
    const cy = y + rowH / 2;
    s += `<rect class="viz-row" data-i="${i}" x="0" y="${y}" width="${W}" height="${rowH}" fill="transparent"/>`;
    s += `<text x="4" y="${cy + (it.sub ? 0 : 4)}" class="viz-label">${esc(it.label)}</text>`;
    if (it.sub) s += `<text x="4" y="${cy + 13}" class="viz-axis">${esc(it.sub)}</text>`;
    if (it.v == null) {
      s += `<text x="${W - 4}" y="${cy + 4}" text-anchor="end" class="viz-axis">記録なし</text>`;
      return;
    }
    const x = X(it.v);
    const w = Math.abs(x - mid);
    const color = it.v > 0 ? C.bad : C.good;
    if (w >= 1) {
      // 0 側は角、先端だけ丸める
      const r = Math.min(4, w);
      const bx = it.v > 0 ? mid : x;
      s += `<path d="${roundedBarPath(bx, cy - 8, w, 16, r, it.v > 0 ? 'right' : 'left')}" fill="${color}" opacity="${it.muted ? 0.4 : 1}"/>`;
    }
    s += `<text x="${W - 4}" y="${cy + 4}" text-anchor="end" class="viz-value">${fmtSigned(it.v)}</text>`;
  });
  s += '</svg>';
  el.innerHTML = s;
}

/** 片側(right/left)だけ角を丸めた棒 */
function roundedBarPath(x, y, w, h, r, side) {
  if (side === 'right') {
    return `M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x} Z`;
  }
  return `M${x + w},${y} H${x + r} Q${x},${y} ${x},${y + r} V${y + h - r} Q${x},${y + h} ${x + r},${y + h} H${x + w} Z`;
}

/* ===== 積み上げ縦棒(区間タイムの推移) ===== */

function drawStacked(el, nights) {
  const W = plotWidth(el);
  const H = 200;
  const m = { l: 46, r: 12, t: 16, b: 24 };
  const ids = tasks().map((t) => t.id);
  const target = mean(nights.map((n) => n.targetTotal));
  const hi = Math.max(target, ...nights.map((n) => ids.reduce((a, id) => a + (n.seg[id] ?? 0), 0))) * 1.08;
  const { ticks } = niceTicks(0, hi, [15, 30, 60, 120]);
  const top = Math.max(hi, ticks[ticks.length - 1]);
  const Y = (v) => H - m.b - (v / top) * (H - m.t - m.b);
  const slot = (W - m.l - m.r) / nights.length;
  const bw = Math.max(2, Math.min(24, slot - 2));
  const cx = (i) => m.l + slot * (i + 0.5);

  let s = svgOpen(W, H, '区間タイムの推移');
  for (const t of ticks) {
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="${C.grid}" stroke-width="1"/>
      <text x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end" class="viz-axis">${fmtAxisMin(t)}</text>`;
  }
  nights.forEach((n, i) => {
    let base = 0;
    ids.forEach((id, k) => {
      const v = n.seg[id] ?? 0;
      if (v <= 0) return;
      const y1 = Y(base + v);
      const y2 = Y(base) - (base > 0 ? 2 : 0); // 区間のあいだに 2px のすき間
      const isTop = k === ids.length - 1;
      const h = Math.max(0, y2 - y1);
      s += isTop
        ? `<path d="${roundedTopPath(cx(i) - bw / 2, y1, bw, h, Math.min(4, h, bw / 2))}" fill="${taskColor(id)}"/>`
        : `<rect x="${cx(i) - bw / 2}" y="${y1}" width="${bw}" height="${h}" fill="${taskColor(id)}"/>`;
      base += v;
    });
  });
  const xIdx = [...new Set([0, Math.floor((nights.length - 1) / 2), nights.length - 1])];
  for (const i of xIdx) {
    const anchor = nights.length === 1 ? 'middle' : i === 0 ? 'start' : i === nights.length - 1 ? 'end' : 'middle';
    const x = anchor === 'start' ? cx(i) - bw / 2 : anchor === 'end' ? cx(i) + bw / 2 : cx(i);
    s += `<text x="${x}" y="${H - 6}" text-anchor="${anchor}" class="viz-axis">${esc(keyLabel(nights[i].key, false))}</text>`;
  }
  s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(target)}" y2="${Y(target)}" stroke="${C.target}" stroke-width="1" stroke-dasharray="4 4"/>`;
  s += '<rect class="viz-hl" x="0" y="0" width="0" height="0" fill="rgba(255,255,255,.06)" pointer-events="none"/>';
  s += '</svg>';
  el.innerHTML = s;

  const svg = el.querySelector('svg');
  const hl = svg.querySelector('.viz-hl');
  bindPick(svg, W, (x) => {
    const i = Math.floor((x - m.l) / slot);
    return i >= 0 && i < nights.length ? i : -1;
  }, (i, e) => {
    if (i < 0) { hl.setAttribute('width', 0); return; }
    hl.setAttribute('x', m.l + slot * i);
    hl.setAttribute('y', m.t);
    hl.setAttribute('width', slot);
    hl.setAttribute('height', H - m.t - m.b);
    const n = nights[i];
    showTip(e.clientX, e.clientY, keyLabel(n.key), [
      ...ids.map((id) => ({ color: taskColor(id), value: fmtMinDur(n.seg[id] ?? 0), label: `${taskById(id).name}(目標${fmtSigned(n.parts[id])})` })),
      { value: fmtMinDur(n.totalMin), label: '合計' },
    ]);
  });
}

function roundedTopPath(x, y, w, h, r) {
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/* ===== 単色の横棒(順番の比較) ===== */

/** items: [{ label, v (分), text, sub }] */
function drawHBars(el, items, title) {
  const W = plotWidth(el);
  const rowH = 40;
  const m = { l: 104, r: 76, t: 4, b: 4 };
  const H = m.t + items.length * rowH + m.b;
  const max = Math.max(1, ...items.map((it) => it.v ?? 0));
  let s = svgOpen(W, H, title);
  items.forEach((it, i) => {
    const cy = m.t + i * rowH + rowH / 2;
    s += `<text x="4" y="${cy}" class="viz-label">${esc(it.label)}</text>
      <text x="4" y="${cy + 14}" class="viz-axis">${esc(it.sub)}</text>`;
    if (it.v == null) {
      s += `<text x="${m.l}" y="${cy + 4}" class="viz-axis">まだ記録なし</text>`;
      return;
    }
    const w = (it.v / max) * (W - m.l - m.r);
    s += `<path d="${roundedBarPath(m.l, cy - 9, Math.max(w, 1), 18, Math.min(4, w), 'right')}" fill="${C.avg}"/>
      <text x="${m.l + w + 6}" y="${cy + 4}" class="viz-value">${esc(it.text)}</text>`;
  });
  s += '</svg>';
  el.innerHTML = s;
}

/* ===== 表 ===== */

function tableHtml(head, rows) {
  return `<table class="viz-table-el"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

/* ===== 分析画面 ===== */

function legendHtml(items) {
  return items.map(([kind, color, label]) =>
    `<span class="viz-legend-item"><span class="viz-key ${kind}" style="${kind === 'dash' ? 'border-color' : 'background'}:${color}"></span>${esc(label)}</span>`).join('');
}

function card(id, title, sub, legend = '') {
  return `<section class="viz-card" id="${id}">
    <div class="viz-head"><h3>${esc(title)}</h3><button class="viz-table-btn" type="button">表で見る</button></div>
    ${sub ? `<p class="viz-sub">${sub}</p>` : ''}
    ${legend ? `<div class="viz-legend">${legend}</div>` : ''}
    <div class="viz-plot"></div><div class="viz-table" hidden></div></section>`;
}

function kpiTile(label, value, sub, delta) {
  return `<div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${esc(value)}</div>
    <div class="kpi-sub">${sub}</div>${delta ? `<div class="kpi-delta">${delta}</div>` : ''}</div>`;
}

/** better: 小さいほど良いなら 'lower'。差がなければ「±0」 */
function deltaText(cur, prev, fmt, better, prevLabel) {
  if (cur == null || prev == null) return '';
  const d = cur - prev;
  if (Math.abs(d) < 0.5) return `${esc(prevLabel)}と同じ`;
  const good = better === 'lower' ? d < 0 : d > 0;
  const arrow = d < 0 ? '▼' : '▲';
  return `<span class="${good ? 'up-good' : 'up-bad'}">${arrow} ${good ? '良化' : '悪化'}</span> ${esc(prevLabel)}より${fmt(Math.abs(d))}`;
}

function renderAnalysis() {
  const filters = [['7', '直近7日'], ['30', '直近30日'], ['month', '今月'], ['all', '全期間']];
  $('analysis-filter').innerHTML = filters.map(([k, l]) =>
    `<button class="tab" data-period="${k}" aria-selected="${k === anaPeriod}">${l}</button>`).join('');

  const all = buildNights();
  const p = periodOf(anaPeriod);
  const nights = inRange(all, p);
  const prev = p.prev ? inRange(all, p.prev) : [];
  const body = $('analysis-body');

  if (!nights.length) {
    body.innerHTML = `<div class="empty">この期間の記録はまだありません。<br>${all.length ? '期間を広げてみてください。' : '玄関を開けたら START！'}</div>`;
    return;
  }

  const T = targetBedMinutes();
  const avg = (ns, f) => mean(ns.map(f));
  const okCount = nights.filter((n) => n.ok).length;
  const rate = (ns) => (ns.length ? (ns.filter((n) => n.ok).length / ns.length) * 100 : null);
  const curBed = avg(nights, (n) => n.bedMin);
  const kpis = [
    kpiTile('平均就寝', fmtMinClock(curBed), `目標${fmtSigned(curBed - T)}`,
      deltaText(curBed, avg(prev, (n) => n.bedMin), fmtMinDur, 'lower', p.prevLabel)),
    kpiTile('目標達成', `${okCount}/${nights.length}日`, `${Math.round(rate(nights))}%`,
      deltaText(rate(nights), rate(prev), (v) => `${Math.round(v)}pt`, 'higher', p.prevLabel)),
    kpiTile('平均合計タイム', fmtMinDur(avg(nights, (n) => n.totalMin)), `目標 ${fmtMinDur(avg(nights, (n) => n.targetTotal))}`,
      deltaText(avg(nights, (n) => n.totalMin), avg(prev, (n) => n.totalMin), fmtMinDur, 'lower', p.prevLabel)),
    kpiTile('平均帰宅', fmtMinClock(avg(nights, (n) => n.startMin)), '🚪 玄関オープン',
      deltaText(avg(nights, (n) => n.startMin), avg(prev, (n) => n.startMin), fmtMinDur, 'lower', p.prevLabel)),
  ];

  const taskLegend = legendHtml(tasks().map((t) => ['bar', taskColor(t.id), t.name]));
  body.innerHTML = `<div class="kpi-grid">${kpis.join('')}</div>
    ${card('viz-cause', '就寝が遅れる原因', `目標就寝との差を「帰宅の遅れ」と各タスクの「目標超過」に分けた平均です。帰宅の遅れは、目標ペースで間に合う帰宅時刻との差です。`)}
    ${card('viz-timeline', '夜のタイムライン', '🚪帰宅から就寝まで。行をタップで内訳。',
      taskLegend + legendHtml([['bar', C.other, '一時停止など'], ['dash', C.target, `目標 ${store.settings.targetBed}`]]))}
    ${card('viz-bed', '就寝時刻の推移', '点の色は目標内(緑)・超過(赤)。タップで日ごとの値。',
      legendHtml([['dot', C.ink, '就寝'], ['line', C.avg, '7日平均'], ['dash', C.target, `目標 ${store.settings.targetBed}`]]))}
    ${card('viz-stack', '区間タイムの推移', 'どちらのタスクが伸びているか。タップで日ごとの値。',
      taskLegend + legendHtml([['dash', C.target, `目標合計 ${fmtMinDur(avg(nights, (n) => n.targetTotal))}`]]))}
    ${card('viz-order', '順番の比較', 'どちらの順番だと早く終わるか(平均合計タイム)。')}
    ${card('viz-dow', '曜日別の就寝', '目標就寝との差の平均。記録が1回だけの曜日は薄く表示。')}`;

  const plot = (id) => $(id).querySelector('.viz-plot');
  const table = (id, html) => { $(id).querySelector('.viz-table').innerHTML = html; };
  const needMore = (id, n) => {
    plot(id).innerHTML = `<div class="viz-empty">あと${n}日分記録すると表示されます</div>`;
  };

  // 遅れの原因
  const causeItems = [
    { key: 'arrival', label: '🚪 帰宅の遅れ' },
    ...tasks().map((t) => ({ key: t.id, label: `${t.name}の超過` })),
    { key: 'other', label: '一時停止など' },
  ].map((c) => ({ ...c, v: avg(nights, (n) => n.parts[c.key]) }))
    .filter((c) => c.key !== 'other' || Math.abs(c.v) >= 1);
  const avgDelay = avg(nights, (n) => n.delay);
  const worst = causeItems.reduce((a, b) => (b.v > a.v ? b : a));
  const headline = worst.v <= 0.5
    ? '帰宅も作業も目標ペース以内。この調子！'
    : worst.key === 'arrival'
      ? `帰宅が平均${fmtSigned(worst.v)}遅め。そのぶん作業を短くしないと間に合いません。`
      : `${worst.label.replace('の超過', '')}が平均${fmtSigned(worst.v)}。ここを縮めるのが一番効きます。`;
  plot('viz-cause').insertAdjacentHTML('beforebegin',
    `<div class="viz-headline">${esc(headline)}</div>
     <div class="viz-sum">平均の就寝 = 目標${fmtSigned(avgDelay)}（${causeItems.map((c) => `${esc(c.label.replace('🚪 ', ''))} ${fmtSigned(c.v)}`).join(' ＋ ')}）</div>`);
  drawDiverging(plot('viz-cause'), causeItems, '就寝が遅れる原因');
  table('viz-cause', tableHtml(['要因', '平均(目標比)'], [...causeItems.map((c) => [c.label, fmtSigned(c.v)]), ['合計(就寝の目標差)', fmtSigned(avgDelay)]]));

  // タイムライン
  drawTimeline(plot('viz-timeline'), nights);
  if (nights.length > TIMELINE_MAX) {
    plot('viz-timeline').insertAdjacentHTML('beforeend', `<div class="viz-note">直近${TIMELINE_MAX}日を表示しています(全${nights.length}日は表で確認できます)</div>`);
  }
  table('viz-timeline', tableHtml(['日付', '帰宅', ...tasks().map((t) => t.name), '就寝', '目標差'],
    [...nights].reverse().map((n) => [keyLabel(n.key), fmtMinClock(n.startMin), ...tasks().map((t) => fmtMinDur(n.seg[t.id] ?? 0)), fmtMinClock(n.bedMin), fmtSigned(n.delay)])));

  // 就寝時刻の推移(7日平均つき)
  const withAvg = nights.map((n) => {
    const win = all.filter((o) => o.idx <= n.idx && o.idx > n.idx - 7);
    return { x: n.idx, v: n.bedMin, ok: n.ok, label: keyLabel(n.key, false), avg: win.length >= 2 ? mean(win.map((o) => o.bedMin)) : null, n };
  });
  if (nights.length < 2) needMore('viz-bed', 2 - nights.length);
  else {
    drawLine(plot('viz-bed'), withAvg, {
      target: T, kind: 'clock', title: '就寝時刻の推移',
      tipRows: (i) => ({
        title: keyLabel(withAvg[i].n.key),
        rows: [
          { color: withAvg[i].ok ? C.good : C.bad, value: fmtMinClock(withAvg[i].v), label: `就寝 ${withAvg[i].ok ? '✓' : '✗'} 目標${fmtSigned(withAvg[i].v - T)}` },
          ...(withAvg[i].avg != null ? [{ color: C.avg, value: fmtMinClock(withAvg[i].avg), label: '7日平均' }] : []),
        ],
      }),
    });
  }
  table('viz-bed', tableHtml(['日付', '就寝', '7日平均', '目標差'],
    [...withAvg].reverse().map((w) => [keyLabel(w.n.key), fmtMinClock(w.v), w.avg != null ? fmtMinClock(w.avg) : '-', fmtSigned(w.v - T)])));

  // 区間タイムの推移
  if (nights.length < 2) needMore('viz-stack', 2 - nights.length);
  else drawStacked(plot('viz-stack'), nights);
  table('viz-stack', tableHtml(['日付', ...tasks().map((t) => t.name), '合計'],
    [...nights].reverse().map((n) => [keyLabel(n.key), ...tasks().map((t) => fmtMinDur(n.seg[t.id] ?? 0)), fmtMinDur(n.totalMin)])));

  // 順番の比較
  const orders = tasks().map((t) => orderFrom(t.id));
  const orderItems = orders.map((ids) => {
    const ns = nights.filter((n) => n.order.join() === ids.join());
    const label = ids.map((id) => taskById(id).name).join('→');
    if (!ns.length) return { label, v: null, sub: '0回', text: '' };
    const tot = avg(ns, (n) => n.totalMin);
    return { label, v: tot, sub: `${ns.length}回・就寝 ${fmtMinClock(avg(ns, (n) => n.bedMin))}`, text: fmtMinDur(tot), bed: avg(ns, (n) => n.bedMin), count: ns.length };
  });
  drawHBars(plot('viz-order'), orderItems, '順番の比較');
  table('viz-order', tableHtml(['順番', '回数', '平均合計', '平均就寝'],
    orderItems.map((o) => [o.label, `${o.count ?? 0}回`, o.v != null ? fmtMinDur(o.v) : '-', o.bed != null ? fmtMinClock(o.bed) : '-'])));

  // 曜日別
  const dowItems = [1, 2, 3, 4, 5, 6, 0].map((dow) => {
    const ns = nights.filter((n) => { const [y, mo, d] = n.key.split('-').map(Number); return new Date(y, mo - 1, d).getDay() === dow; });
    return { label: '日月火水木金土'[dow] + '曜', sub: `${ns.length}回`, v: ns.length ? avg(ns, (n) => n.delay) : null, muted: ns.length === 1, count: ns.length, bed: ns.length ? avg(ns, (n) => n.bedMin) : null };
  });
  drawDiverging(plot('viz-dow'), dowItems, '曜日別の就寝');
  table('viz-dow', tableHtml(['曜日', '回数', '平均就寝', '目標差'],
    dowItems.map((d) => [d.label, `${d.count}回`, d.bed != null ? fmtMinClock(d.bed) : '-', d.v != null ? fmtSigned(d.v) : '-'])));
}

$('analysis-filter').addEventListener('click', (e) => {
  const b = e.target.closest('[data-period]');
  if (!b) return;
  anaPeriod = b.dataset.period;
  hideTip();
  renderAnalysis();
});

$('analysis-body').addEventListener('click', (e) => {
  const b = e.target.closest('.viz-table-btn');
  if (!b) return;
  const c = b.closest('.viz-card');
  const t = c.querySelector('.viz-table');
  t.hidden = !t.hidden;
  c.querySelector('.viz-plot').hidden = !t.hidden;
  b.textContent = t.hidden ? '表で見る' : 'グラフで見る';
  hideTip();
});

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (currentScreen === 'analysis') renderAnalysis();
    if (currentScreen === 'history') renderHistory();
  }, 200);
});

/* ===== 歴代記録タブの推移グラフ ===== */

/**
 * 歴代記録の各タブ用。records の直近30回を、kind に合わせて描く。
 * valueOf(r) は秒(time)か夜の分(clock)。
 */
function drawHistoryTrend(el, records, valueOf, target, kind) {
  const list = records.slice(-30).filter((r) => valueOf(r) != null);
  if (list.length < 2) { el.remove(); return; }
  const toMin = (v) => (kind === 'time' ? v / 60 : v);
  const tgt = toMin(target);
  const pts = list.map((r, i) => {
    const v = toMin(valueOf(r));
    return { x: i, v, ok: v <= tgt, label: keyLabel(dayKeyOf(r.startedAt ?? r.finishedAt), false), r };
  });
  const tgtText = kind === 'time' ? fmtRta(target) : fmtMinClock(tgt);
  el.innerHTML = `<div class="viz-sub">直近${pts.length}回の推移(下ほど良い)。タップで値。</div>
    <div class="viz-legend">${legendHtml([['dot', C.good, '目標内'], ['dot', C.bad, '超過'], ['dash', C.target, `目標 ${tgtText}`]])}</div>
    <div class="viz-plot"></div>`;
  drawLine(el.querySelector('.viz-plot'), pts, {
    target: tgt, kind: kind === 'time' ? 'dur' : 'clock', title: '推移',
    tipRows: (i) => {
      const p = pts[i];
      const fmt = kind === 'time' ? fmtRta : fmtMinClock;
      return {
        title: fmtDate(p.r.startedAt ?? p.r.finishedAt),
        rows: [{ color: p.ok ? C.good : C.bad, value: kind === 'time' ? fmt(p.v * 60) : fmt(p.v), label: `目標${fmtSigned(p.v - tgt)}` }],
      };
    },
  });
}
