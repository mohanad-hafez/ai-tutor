import type { FrameContent } from '../types';
import { useGraphStore } from '../store/graphStore';

// Canned, no-API demo lessons. Each one is a step-by-step interactive
// walkthrough that bypasses the agent pipeline so the demo flow is
// 100% reliable and fast. New demos are matched by `match()` against
// the user's highlighted text (with no chat question typed). Order in
// the registry is priority — first match wins.
//
// Renders inside the same lesson iframe shell (BASE_CSS gives the
// indigo-on-#0a0a0a theme); KaTeX auto-loads thanks to $...$ delimiters.

// ─────────────────────────────────────────────────────────────────
// Lesson 1 — "Linear Regression"
// ─────────────────────────────────────────────────────────────────
const LR_HTML = `
<header class="lh">
  <div class="dots" role="progressbar" aria-valuemin="1" aria-valuemax="6" aria-valuenow="1">
    <span class="dot active" data-step="1"></span>
    <span class="dot" data-step="2"></span>
    <span class="dot" data-step="3"></span>
    <span class="dot" data-step="4"></span>
    <span class="dot" data-step="5"></span>
    <span class="dot" data-step="6"></span>
  </div>
  <h1 id="stepTitle">Data starts as a table</h1>
  <p class="kicker">Linear Regression · a six-step interactive walkthrough</p>
</header>

<div class="stage">
  <div class="data-card card">
    <h3>Dataset</h3>
    <div class="data-table-wrap">
      <table class="data-table">
        <thead><tr><th>x</th><th>y</th></tr></thead>
        <tbody id="tbody"></tbody>
      </table>
    </div>
    <div class="data-foot"><span class="count" id="rowCount">0</span> obs · <span id="userCount">0</span> added</div>
  </div>

  <div class="plot-wrap card" id="plotWrap">
    <svg id="plot" viewBox="0 0 520 320" preserveAspectRatio="xMidYMid meet" aria-label="Scatter plot">
      <defs>
        <linearGradient id="lineGrad" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stop-color="#818cf8"/>
          <stop offset="100%" stop-color="#a78bfa"/>
        </linearGradient>
      </defs>
      <g id="grid"></g>
      <g id="axes">
        <line x1="48" y1="280" x2="500" y2="280" stroke="#2a2a32" stroke-width="1"/>
        <line x1="48" y1="20" x2="48" y2="280" stroke="#2a2a32" stroke-width="1"/>
        <text x="496" y="298" text-anchor="end" fill="#71717a" font-size="11" font-family="ui-monospace,monospace">x</text>
        <text x="32" y="26" text-anchor="end" fill="#71717a" font-size="11" font-family="ui-monospace,monospace">y</text>
      </g>
      <rect id="hitArea" x="48" y="20" width="452" height="260" fill="transparent"/>
      <g id="residuals" class="hidden"></g>
      <line id="fitLine" class="hidden" x1="48" y1="280" x2="500" y2="20" stroke="url(#lineGrad)" stroke-width="2.5" stroke-linecap="round"/>
      <g id="points"></g>
    </svg>
    <div class="floating-readout">
      <div id="eqWrap" class="readout-pill hidden">
        <span class="lbl">line</span>
        <span class="val mono" id="eqOut">y = 0.60·x + 1.0</span>
      </div>
      <div id="sseWrap" class="readout-pill hidden">
        <span class="lbl">SSE</span>
        <span class="val mono" id="sseOut">—</span>
      </div>
    </div>
    <div id="tooltip" class="tooltip hidden">
      <div class="tt-row"><span class="lbl" id="ttHead">obs</span><span class="val mono" id="ttIdx">#1</span></div>
      <div class="tt-row"><span class="lbl">x</span><span class="val mono" id="ttX">0.00</span></div>
      <div class="tt-row"><span class="lbl">y</span><span class="val mono" id="ttY">0.00</span></div>
      <div class="tt-row tt-pred-row hidden"><span class="lbl">ŷ</span><span class="val mono" id="ttPred">0.00</span></div>
      <div class="tt-row tt-res-row hidden"><span class="lbl">residual</span><span class="val mono tt-res" id="ttRes">0.00</span></div>
    </div>
  </div>

  <aside class="side card hidden" id="side">
    <h3>Controls</h3>
    <div class="row">
      <label>Slope <code>m</code></label>
      <input type="range" id="m" min="-3" max="3" step="0.05" value="0.6"/>
      <output id="mOut">0.60</output>
    </div>
    <div class="row">
      <label>Intercept <code>b</code></label>
      <input type="range" id="b" min="-4" max="6" step="0.1" value="1"/>
      <output id="bOut">1.0</output>
    </div>
    <div id="fitBlock" class="hidden">
      <button id="fitBtn" class="btn-primary fit-btn">Find best fit</button>
      <p class="formula-mini">$$m^*,b^* = \\arg\\min_{m,b} \\sum_i (y_i - mx_i - b)^2$$</p>
    </div>
  </aside>
</div>

<div id="ctlAdd" class="controls card hidden">
  <div class="actions">
    <span class="hint" style="flex:1">Click anywhere on the chart to add a point. Hover any point for details.</span>
    <button id="clearBtn" class="btn-ghost">Clear added</button>
  </div>
</div>

<div id="narrative" class="narrative card"></div>

<footer class="lf">
  <button id="prevBtn" class="btn-ghost" disabled>← Back</button>
  <span class="step-count">Step <span id="stepNum">1</span> of 6</span>
  <button id="nextBtn" class="btn-primary">Next →</button>
  <button id="restartBtn" class="btn-ghost hidden">Restart</button>
</footer>
`;

const SHARED_CSS = `
.lh{margin-bottom:18px;}
.lh h1{margin:6px 0 4px;font-size:24px;letter-spacing:-0.01em;}
.lh .kicker{color:#a1a1aa;font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin:0;}
.dots{display:flex;gap:8px;margin-bottom:10px;}
.dots .dot{width:8px;height:8px;border-radius:999px;background:#27272a;transition:background .25s,transform .25s,box-shadow .25s;}
.dots .dot.active{background:#818cf8;box-shadow:0 0 0 4px rgba(129,140,248,.18);}
.dots .dot.done{background:#4f46e5;}

.card{border:1px solid #1f1f24;background:#0e0e12;border-radius:12px;}
.hidden{display:none !important;}

.narrative{padding:16px 18px;line-height:1.55;color:#d4d4d8;font-size:14px;}
.narrative h2{margin:0 0 8px;font-size:15px;color:#e0e7ff;letter-spacing:.01em;}
.narrative p{margin:0 0 8px;}
.narrative p:last-child{margin-bottom:0;}
.narrative b{color:#c4b5fd;font-weight:600;}
.narrative em{color:#fbbf24;font-style:normal;}
.narrative .tip{margin-top:10px;padding:8px 10px;border-left:2px solid #6366f1;background:rgba(99,102,241,.06);border-radius:0 6px 6px 0;font-size:13px;color:#cbd5e1;}

.lf{margin-top:18px;display:flex;align-items:center;gap:12px;}
.lf .step-count{margin-left:auto;margin-right:auto;color:#71717a;font-size:12px;}
.lf button{min-width:96px;}
.lf button:disabled{opacity:.4;cursor:not-allowed;}
`;

const LR_CSS = SHARED_CSS + `
.stage{display:grid;grid-template-columns:0.5fr 1.5fr;gap:12px;align-items:start;}
.stage.with-side{grid-template-columns:0.45fr 1.4fr 0.5fr;}
@media (max-width: 860px){ .stage,.stage.with-side{grid-template-columns:1fr;} }

.data-card{padding:12px 14px;display:flex;flex-direction:column;gap:8px;min-height:300px;}
.data-card h3{margin:0;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#71717a;font-weight:500;}
.data-table-wrap{max-height:240px;overflow-y:auto;overflow-x:hidden;}
.data-table-wrap::-webkit-scrollbar{width:6px;}
.data-table-wrap::-webkit-scrollbar-thumb{background:#27272a;border-radius:3px;}
.data-table{width:100%;border-collapse:collapse;font-family:ui-monospace,monospace;font-size:13px;}
.data-table thead th{text-align:left;padding:5px 6px;font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#71717a;border-bottom:1px solid #1f1f24;background:#0e0e12;position:sticky;top:0;z-index:1;}
.data-table td{padding:5px 6px;color:#e5e5e5;border-bottom:1px solid #15151b;width:50%;}
.data-table tr.flash{background:rgba(99,102,241,.18);transition:background 1s;}
.data-table tr.user-row td{color:#67e8f9;}
.data-foot{font-size:11px;color:#71717a;border-top:1px solid #1f1f24;padding-top:8px;margin-top:auto;}
.data-foot .count{color:#c4b5fd;font-family:ui-monospace,monospace;font-size:12px;}
.data-foot #userCount{color:#67e8f9;font-family:ui-monospace,monospace;font-size:12px;}

.plot-wrap{position:relative;padding:8px;}
#plot{display:block;width:100%;height:auto;}
.plot-wrap.adding #plot{cursor:crosshair;}
.plot-wrap.adding #hitArea{fill:rgba(34,211,238,.04);}
#points circle{fill:#fbbf24;stroke:#0a0a0d;stroke-width:1.5;cursor:pointer;transition:r .2s,filter .25s;}
#points circle:hover{r:6.5;filter:drop-shadow(0 0 5px rgba(251,191,36,.7));}
#points circle.user{fill:#22d3ee;}
#points circle.user:hover{filter:drop-shadow(0 0 5px rgba(34,211,238,.85));}
#points circle.flash{filter:drop-shadow(0 0 8px rgba(251,191,36,.95));}
#residuals line{stroke:#f43f5e;stroke-width:1.2;stroke-dasharray:3 3;opacity:.85;pointer-events:none;}
#fitLine{filter:drop-shadow(0 0 6px rgba(129,140,248,.35));transition:opacity .25s;pointer-events:none;}

.floating-readout{position:absolute;top:14px;right:14px;display:flex;flex-direction:column;gap:6px;align-items:flex-end;pointer-events:none;}
.readout-pill{display:inline-flex;align-items:center;gap:8px;padding:5px 10px;background:rgba(15,15,20,.85);border:1px solid #1f1f24;border-radius:999px;backdrop-filter:blur(6px);font-size:12px;}
.readout-pill .lbl{color:#71717a;text-transform:uppercase;letter-spacing:.08em;font-size:10px;}
.readout-pill .val{color:#e5e5e5;}
.readout-pill .val.mono{font-family:ui-monospace,monospace;}
.readout-pill .val.flash{color:#a78bfa;transition:color .4s;}

.tooltip{position:absolute;pointer-events:none;background:rgba(13,13,17,0.97);border:1px solid #2a2a32;border-radius:8px;padding:8px 10px;font-size:11.5px;color:#d4d4d8;transform:translate(-50%,-100%) translateY(-12px);z-index:5;box-shadow:0 8px 24px -8px rgba(0,0,0,.85);min-width:140px;}
.tooltip .tt-row{display:flex;justify-content:space-between;gap:14px;line-height:1.5;}
.tooltip .tt-row .lbl{color:#71717a;font-size:10px;text-transform:uppercase;letter-spacing:.08em;}
.tooltip .tt-row .val{color:#e5e5e5;}
.tooltip .tt-row .val.mono{font-family:ui-monospace,monospace;}
.tooltip .tt-row .val.tt-res{color:#fda4af;}
.tooltip::after{content:"";position:absolute;top:100%;left:50%;margin-left:-6px;border:6px solid transparent;border-top-color:#2a2a32;}

.narrative{margin-top:12px;}

.side{padding:12px 14px;display:flex;flex-direction:column;gap:10px;}
.side h3{margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#71717a;font-weight:500;}
.side .row{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;}
.side label{font-size:12px;color:#a1a1aa;white-space:nowrap;}
.side code{background:#15151b;color:#c4b5fd;padding:1px 6px;border-radius:5px;font-size:11px;}
.side output{font-family:ui-monospace,monospace;font-size:12px;color:#e5e5e5;background:#15151b;padding:3px 8px;border-radius:6px;min-width:42px;text-align:center;}
.side input[type=range]{accent-color:#818cf8;width:100%;}
.side .fit-btn{width:100%;margin-top:6px;}
.side .formula-mini{margin:8px 0 0;text-align:center;color:#a1a1aa;font-size:11px;line-height:1.4;}

.controls{padding:14px 16px;margin-top:12px;}
.controls .actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}
.controls .hint{margin:0;font-size:12px;color:#71717a;}
`;

const LR_JS = `
const ORIGINAL = [
  {x:1.0,y:1.4},{x:2.0,y:2.1},{x:2.7,y:2.0},
  {x:3.5,y:3.4},{x:4.2,y:3.1},{x:5.0,y:4.6},
  {x:5.8,y:4.2},{x:6.6,y:5.5},{x:7.5,y:6.1},
  {x:8.4,y:6.8},
];
const points = ORIGINAL.map(p => ({...p}));
const userFlags = points.map(() => false);

const X_MIN=0,X_MAX=10,Y_MIN=-1,Y_MAX=9;
const PAD_L=48,PAD_R=20,PAD_T=20,PAD_B=40;
const W=520,H=320;
const sx=(x)=>PAD_L+(x-X_MIN)/(X_MAX-X_MIN)*(W-PAD_L-PAD_R);
const sy=(y)=>H-PAD_B-(y-Y_MIN)/(Y_MAX-Y_MIN)*(H-PAD_T-PAD_B);
const invSx=(px)=>X_MIN+(px-PAD_L)/(W-PAD_L-PAD_R)*(X_MAX-X_MIN);
const invSy=(py)=>Y_MIN+(H-PAD_B-py)/(H-PAD_T-PAD_B)*(Y_MAX-Y_MIN);

const gridG=document.getElementById('grid');
for(let gx=0;gx<=10;gx+=2){
  const ln=document.createElementNS('http://www.w3.org/2000/svg','line');
  ln.setAttribute('x1',sx(gx));ln.setAttribute('x2',sx(gx));
  ln.setAttribute('y1',sy(Y_MIN));ln.setAttribute('y2',sy(Y_MAX));
  ln.setAttribute('stroke','#15151b');ln.setAttribute('stroke-width','1');
  gridG.appendChild(ln);
}
for(let gy=0;gy<=8;gy+=2){
  const ln=document.createElementNS('http://www.w3.org/2000/svg','line');
  ln.setAttribute('x1',sx(X_MIN));ln.setAttribute('x2',sx(X_MAX));
  ln.setAttribute('y1',sy(gy));ln.setAttribute('y2',sy(gy));
  ln.setAttribute('stroke','#15151b');ln.setAttribute('stroke-width','1');
  gridG.appendChild(ln);
}

const ptsG = document.getElementById('points');
const tbody = document.getElementById('tbody');
const plotWrap = document.getElementById('plotWrap');
const plotSvg = document.getElementById('plot');

const els = {
  m: document.getElementById('m'),
  b: document.getElementById('b'),
  mOut: document.getElementById('mOut'),
  bOut: document.getElementById('bOut'),
  eqOut: document.getElementById('eqOut'),
  sseOut: document.getElementById('sseOut'),
  fitLine: document.getElementById('fitLine'),
  residuals: document.getElementById('residuals'),
  eqWrap: document.getElementById('eqWrap'),
  sseWrap: document.getElementById('sseWrap'),
  ctlAdd: document.getElementById('ctlAdd'),
  side: document.getElementById('side'),
  fitBlock: document.getElementById('fitBlock'),
  stage: document.querySelector('.stage'),
  narrative: document.getElementById('narrative'),
  stepTitle: document.getElementById('stepTitle'),
  stepNum: document.getElementById('stepNum'),
  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),
  restartBtn: document.getElementById('restartBtn'),
  fitBtn: document.getElementById('fitBtn'),
  clearBtn: document.getElementById('clearBtn'),
  rowCount: document.getElementById('rowCount'),
  userCount: document.getElementById('userCount'),
  tooltip: document.getElementById('tooltip'),
  ttHead: document.getElementById('ttHead'),
  ttIdx: document.getElementById('ttIdx'),
  ttX: document.getElementById('ttX'),
  ttY: document.getElementById('ttY'),
  ttPred: document.getElementById('ttPred'),
  ttRes: document.getElementById('ttRes'),
  ttPredRow: document.querySelector('.tt-pred-row'),
  ttResRow: document.querySelector('.tt-res-row'),
  dots: Array.from(document.querySelectorAll('.dots .dot')),
};

let timers = [];
function clearTimers(){ timers.forEach(t=>clearTimeout(t)); timers=[]; }
function later(fn, ms){ const t = setTimeout(fn, ms); timers.push(t); return t; }
function show(el){ el.classList.remove('hidden'); }
function hide(el){ el.classList.add('hidden'); }

let circles = [];
let tableRows = [];
let cur = 1;

function updateCounts(){
  els.rowCount.textContent = String(points.length);
  els.userCount.textContent = String(userFlags.filter(Boolean).length);
}

function bindCircleHover(c, idx){
  c.addEventListener('mouseenter', (e)=>onPointEnter(idx, e));
  c.addEventListener('mousemove', (e)=>moveTooltip(e));
  c.addEventListener('mouseleave', ()=>hide(els.tooltip));
}

function createCircle(idx){
  const p = points[idx];
  const c = document.createElementNS('http://www.w3.org/2000/svg','circle');
  c.setAttribute('cx', sx(p.x));
  c.setAttribute('cy', sy(p.y));
  c.setAttribute('r', 0);
  if (userFlags[idx]) c.classList.add('user');
  c.dataset.i = String(idx);
  bindCircleHover(c, idx);
  ptsG.appendChild(c);
  return c;
}

function createRow(idx){
  const p = points[idx];
  const tr = document.createElement('tr');
  const tdX = document.createElement('td'); tdX.textContent = p.x.toFixed(2);
  const tdY = document.createElement('td'); tdY.textContent = p.y.toFixed(2);
  tr.appendChild(tdX); tr.appendChild(tdY);
  if (userFlags[idx]) tr.classList.add('user-row');
  tr.dataset.i = String(idx);
  tbody.appendChild(tr);
  return tr;
}

// Initial build: rows are visible (table is the headline of step 1),
// circles exist but are invisible (r=0) until step 2 plots them.
for (let i=0;i<points.length;i++){
  circles.push(createCircle(i));
  tableRows.push(createRow(i));
}
updateCounts();

function setAllDotsVisible(visible){
  circles.forEach(c => c.setAttribute('r', visible ? 4.5 : 0));
}

function staggerPlotDots(){
  circles.forEach((c, i) => {
    later(()=>{
      c.setAttribute('r', 4.5);
      c.classList.add('flash');
      const tr = tableRows[i];
      tr.classList.add('flash');
      later(()=>{
        c.classList.remove('flash');
        tr.classList.remove('flash');
      }, 700);
    }, 100 + i*180);
  });
}

function renderLine(opts){
  opts = opts || {};
  const m = parseFloat(els.m.value);
  const b = parseFloat(els.b.value);
  const x1 = X_MIN, x2 = X_MAX;
  const y1 = m*x1+b, y2 = m*x2+b;
  els.fitLine.setAttribute('x1',sx(x1));
  els.fitLine.setAttribute('y1',sy(y1));
  els.fitLine.setAttribute('x2',sx(x2));
  els.fitLine.setAttribute('y2',sy(y2));

  els.residuals.innerHTML = '';
  let sse = 0;
  for (let i=0;i<points.length;i++){
    const p = points[i];
    const yhat = m*p.x+b;
    const err = p.y-yhat;
    sse += err*err;
    const ln = document.createElementNS('http://www.w3.org/2000/svg','line');
    ln.setAttribute('x1',sx(p.x));ln.setAttribute('x2',sx(p.x));
    ln.setAttribute('y1',sy(p.y));ln.setAttribute('y2',sy(yhat));
    els.residuals.appendChild(ln);
  }

  els.mOut.textContent = m.toFixed(2);
  els.bOut.textContent = b.toFixed(1);
  els.eqOut.textContent = 'y = ' + m.toFixed(2) + '·x + ' + b.toFixed(1);
  els.sseOut.textContent = sse.toFixed(2);
  if (opts.flash){
    els.sseOut.classList.add('flash');
    later(()=>els.sseOut.classList.remove('flash'),600);
  }
}

function onPointEnter(idx, evt){
  const p = points[idx];
  const isUser = userFlags[idx];
  els.ttHead.textContent = isUser ? 'you added' : 'obs';
  els.ttIdx.textContent = '#' + (idx+1);
  els.ttX.textContent = p.x.toFixed(2);
  els.ttY.textContent = p.y.toFixed(2);
  if (cur >= 4){
    const m = parseFloat(els.m.value);
    const b = parseFloat(els.b.value);
    const yhat = m*p.x+b;
    const r = p.y - yhat;
    els.ttPred.textContent = yhat.toFixed(2);
    els.ttRes.textContent = (r >= 0 ? '+' : '') + r.toFixed(2);
    show(els.ttPredRow); show(els.ttResRow);
  } else {
    hide(els.ttPredRow); hide(els.ttResRow);
  }
  show(els.tooltip);
  moveTooltip(evt);
}

function moveTooltip(evt){
  const rect = plotWrap.getBoundingClientRect();
  els.tooltip.style.left = (evt.clientX - rect.left) + 'px';
  els.tooltip.style.top = (evt.clientY - rect.top) + 'px';
}

function addPoint(x, y, isUser){
  const idx = points.length;
  points.push({ x, y });
  userFlags.push(!!isUser);
  const c = createCircle(idx);
  circles.push(c);
  c.setAttribute('r', 6);
  c.classList.add('flash');
  later(()=>{ c.setAttribute('r', 4.5); c.classList.remove('flash'); }, 350);
  const tr = createRow(idx);
  tableRows.push(tr);
  tr.classList.add('flash');
  later(()=>tr.classList.remove('flash'), 900);
  const wrap = document.querySelector('.data-table-wrap');
  if (wrap) wrap.scrollTop = wrap.scrollHeight;
  updateCounts();
  if (cur >= 4) renderLine();
}

function clearUserPoints(){
  for (let i = points.length - 1; i >= 0; i--){
    if (userFlags[i]){
      circles[i].remove();
      tableRows[i].remove();
      points.splice(i, 1);
      userFlags.splice(i, 1);
      circles.splice(i, 1);
      tableRows.splice(i, 1);
    }
  }
  // Re-bind hover handlers with the new indices, and refresh dataset attrs.
  circles.forEach((c, i) => {
    c.dataset.i = String(i);
    tableRows[i].dataset.i = String(i);
    const fresh = c.cloneNode(true);
    c.parentNode.replaceChild(fresh, c);
    bindCircleHover(fresh, i);
    circles[i] = fresh;
  });
  updateCounts();
  if (cur >= 4) renderLine();
}

let canAdd = false;
function setCanAdd(on){
  canAdd = on;
  plotWrap.classList.toggle('adding', on);
}

plotSvg.addEventListener('click', (e) => {
  if (!canAdd) return;
  if (e.target && e.target.tagName === 'circle') return;
  const pt = plotSvg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const ctm = plotSvg.getScreenCTM();
  if (!ctm) return;
  const svgP = pt.matrixTransform(ctm.inverse());
  if (svgP.x < PAD_L || svgP.x > W-PAD_R || svgP.y < PAD_T || svgP.y > H-PAD_B) return;
  addPoint(invSx(svgP.x), invSy(svgP.y), true);
});

const STEPS = [
  {
    n: 1,
    title: 'Data starts as a table',
    body: '<h2>Numbers in rows</h2>'
        + '<p>Linear regression always starts with data — a table where each row is one <b>observation</b>: a pair of numbers, an x and a y. Maybe x is study hours and y is exam score.</p>'
        + '<p>The table on the left shows ten observations. The chart on the right is empty for now — just axes. Press <em>Next</em> to plot each row as a point.</p>',
    enter(){
      hide(els.fitLine); hide(els.residuals);
      hide(els.ctlAdd); hide(els.side); hide(els.fitBlock); els.stage.classList.remove('with-side');
      hide(els.eqWrap); hide(els.sseWrap);
      setCanAdd(false);
      setAllDotsVisible(false);
    },
  },
  {
    n: 2,
    title: 'Plot every observation',
    body: '<h2>Rows become dots</h2>'
        + '<p>Each row in the table becomes one yellow dot at its (x, y) location. One observation alone is just a dot — many of them together start to show <em>shape</em>.</p>'
        + '<p><b>Hover any dot</b> to see its exact x and y values. The pattern is what we will fit a line to.</p>',
    enter(){
      hide(els.fitLine); hide(els.residuals);
      hide(els.ctlAdd); hide(els.side); hide(els.fitBlock); els.stage.classList.remove('with-side');
      hide(els.eqWrap); hide(els.sseWrap);
      setCanAdd(false);
      setAllDotsVisible(false);
      staggerPlotDots();
    },
  },
  {
    n: 3,
    title: 'Add your own observations',
    body: '<h2>Click on the chart to add a point</h2>'
        + '<p>Real datasets grow over time. <b>Click anywhere on the chart</b> to add a new observation — the row appears in the table (highlighted cyan) and a cyan dot pops onto the plot.</p>'
        + '<p>Hover any dot for its values. Use <em>Clear added</em> to drop the points you added and return to the original ten.</p>',
    enter(){
      hide(els.fitLine); hide(els.residuals);
      show(els.ctlAdd); hide(els.side); hide(els.fitBlock); els.stage.classList.remove('with-side');
      hide(els.eqWrap); hide(els.sseWrap);
      setAllDotsVisible(true);
      setCanAdd(true);
    },
  },
  {
    n: 4,
    title: 'Pick a line: y = mx + b',
    body: '<h2>Two knobs, one line</h2>'
        + '<p>Every straight line is described by two numbers: the slope <b>m</b> (how steep) and the intercept <b>b</b> (where it crosses the y-axis).</p>'
        + '<p>Drag the sliders to put the indigo line through the middle of the cloud. The equation pill in the corner of the chart updates live, and hovering any point now shows its <em>predicted ŷ</em> and <em>residual</em>.</p>',
    enter(){
      show(els.fitLine); hide(els.residuals);
      hide(els.ctlAdd); show(els.side); hide(els.fitBlock); els.stage.classList.add('with-side');
      show(els.eqWrap); hide(els.sseWrap);
      setAllDotsVisible(true);
      setCanAdd(false);
      renderLine();
    },
  },
  {
    n: 5,
    title: 'Measure how wrong the line is',
    body: '<h2>Residuals and SSE</h2>'
        + '<p>For every point, the dashed red line is the <em>residual</em>: the gap between what the data was and what your line predicted (<b>y − ŷ</b>).</p>'
        + '<p>Square each residual (so big misses hurt more, and signs do not cancel) and sum them. That is the <b>sum of squared errors</b>, SSE — one number that says how wrong the line is overall. Move the sliders and watch it shrink.</p>',
    enter(){
      show(els.fitLine); show(els.residuals);
      hide(els.ctlAdd); show(els.side); hide(els.fitBlock); els.stage.classList.add('with-side');
      show(els.eqWrap); show(els.sseWrap);
      setAllDotsVisible(true);
      setCanAdd(false);
      renderLine();
    },
  },
  {
    n: 6,
    title: 'Pick the line with the smallest SSE',
    body: '<h2>That is linear regression</h2>'
        + '<p>Linear regression has exactly one job: out of every possible line, find the (m, b) with the <b>smallest SSE</b>.</p>'
        + "<p>It does not have to guess — setting the partial derivatives of SSE to zero gives a clean closed-form solution. Press <em>Find best fit</em> to watch the line slide to the optimum and SSE collapse to its minimum value. The fit uses every point in the table, including any you added.</p>",
    enter(){
      show(els.fitLine); show(els.residuals);
      hide(els.ctlAdd); show(els.side); show(els.fitBlock); els.stage.classList.add('with-side');
      show(els.eqWrap); show(els.sseWrap);
      setAllDotsVisible(true);
      setCanAdd(false);
      renderLine();
    },
  },
];

function goto(n){
  clearTimers();
  hide(els.tooltip);
  cur = Math.max(1, Math.min(STEPS.length, n));
  const step = STEPS[cur-1];
  step.enter();
  els.stepTitle.textContent = step.title;
  els.narrative.innerHTML = step.body;
  els.stepNum.textContent = String(cur);
  els.dots.forEach((d,i)=>{
    d.classList.toggle('active', i+1 === cur);
    d.classList.toggle('done', i+1 < cur);
  });
  els.prevBtn.disabled = cur === 1;
  if (cur === STEPS.length){
    els.nextBtn.classList.add('hidden');
    els.restartBtn.classList.remove('hidden');
  } else {
    els.nextBtn.classList.remove('hidden');
    els.restartBtn.classList.add('hidden');
  }
}

els.prevBtn.addEventListener('click', ()=>goto(cur-1));
els.nextBtn.addEventListener('click', ()=>goto(cur+1));
els.restartBtn.addEventListener('click', ()=>{
  els.m.value = '0.6'; els.b.value = '1';
  clearUserPoints();
  goto(1);
});

els.m.addEventListener('input', ()=>renderLine());
els.b.addEventListener('input', ()=>renderLine());
els.clearBtn.addEventListener('click', clearUserPoints);

els.fitBtn.addEventListener('click', ()=>{
  const n = points.length;
  if (n < 2) return;
  const xbar = points.reduce((s,p)=>s+p.x,0)/n;
  const ybar = points.reduce((s,p)=>s+p.y,0)/n;
  let num=0, den=0;
  points.forEach((p)=>{
    num += (p.x-xbar)*(p.y-ybar);
    den += (p.x-xbar)*(p.x-xbar);
  });
  if (den === 0) return;
  const targetM = num/den;
  const targetB = ybar - targetM*xbar;
  const startM = parseFloat(els.m.value);
  const startB = parseFloat(els.b.value);
  const t0 = performance.now();
  const dur = 2400;
  function frame(t){
    const u = Math.min(1, (t-t0)/dur);
    const e = u<0.5 ? 2*u*u : 1-Math.pow(-2*u+2,2)/2;
    els.m.value = String(startM + (targetM-startM)*e);
    els.b.value = String(startB + (targetB-startB)*e);
    renderLine({ flash: u===1 });
    if (u<1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
});

goto(1);
`;

// ─────────────────────────────────────────────────────────────────
// Lesson 2 — "Look at the data" (child of Linear Regression)
// ─────────────────────────────────────────────────────────────────
const LAD_HTML = `
<header class="lh">
  <div class="dots" role="progressbar" aria-valuemin="1" aria-valuemax="4" aria-valuenow="1">
    <span class="dot active" data-step="1"></span>
    <span class="dot" data-step="2"></span>
    <span class="dot" data-step="3"></span>
    <span class="dot" data-step="4"></span>
  </div>
  <h1 id="stepTitle">One row, one point</h1>
  <p class="kicker">Look at the data · reading a scatter plot</p>
</header>

<div class="stage">
  <div class="table-wrap card">
    <div class="th"><span>x</span><span>y</span></div>
    <div class="tbody-scroll"><table id="dataTable"><tbody id="tbody"></tbody></table></div>
    <div class="t-foot"><span id="rowCount">0 / 10</span> observations</div>
  </div>

  <div class="plot-wrap card">
    <svg id="plot" viewBox="0 0 520 320" preserveAspectRatio="xMidYMid meet" aria-label="Scatter plot">
      <defs>
        <linearGradient id="trendGrad" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stop-color="#818cf8" stop-opacity="0.7"/>
          <stop offset="100%" stop-color="#a78bfa" stop-opacity="0.7"/>
        </linearGradient>
      </defs>
      <g id="grid"></g>
      <g id="axes">
        <line x1="48" y1="280" x2="500" y2="280" stroke="#2a2a32" stroke-width="1"/>
        <line x1="48" y1="20" x2="48" y2="280" stroke="#2a2a32" stroke-width="1"/>
        <text x="496" y="298" text-anchor="end" fill="#71717a" font-size="11" font-family="ui-monospace,monospace">x</text>
        <text x="32" y="26" text-anchor="end" fill="#71717a" font-size="11" font-family="ui-monospace,monospace">y</text>
      </g>
      <path id="spreadBand" class="hidden" fill="rgba(129,140,248,0.10)" stroke="none"/>
      <line id="trendLine" class="hidden" stroke="url(#trendGrad)" stroke-width="2" stroke-dasharray="6 4" stroke-linecap="round"/>
      <circle id="noisyHalo" class="hidden" r="14" fill="none" stroke="#f43f5e" stroke-width="1.5" stroke-dasharray="2 3" opacity="0.9"/>
      <g id="points"></g>
      <g id="trendBadge" class="hidden" transform="translate(360, 60)">
        <rect x="0" y="0" width="124" height="28" rx="14" fill="rgba(99,102,241,0.18)" stroke="rgba(129,140,248,0.4)"/>
        <text x="14" y="18" fill="#c4b5fd" font-size="12" font-family="ui-sans-serif,system-ui">↗ positive trend</text>
      </g>
    </svg>
  </div>
</div>

<aside class="below">
  <div id="narrative" class="narrative card"></div>
</aside>

<footer class="lf">
  <button id="prevBtn" class="btn-ghost" disabled>← Back</button>
  <span class="step-count">Step <span id="stepNum">1</span> of 4</span>
  <button id="nextBtn" class="btn-primary">Next →</button>
  <button id="restartBtn" class="btn-ghost hidden">Restart</button>
</footer>
`;

const LAD_CSS = SHARED_CSS + `
.stage{display:grid;grid-template-columns:0.7fr 1.4fr;gap:16px;align-items:start;}
@media (max-width: 760px){ .stage{grid-template-columns:1fr;} }

.table-wrap{padding:12px 14px;display:flex;flex-direction:column;gap:8px;}
.table-wrap .th{display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#71717a;padding:0 4px 6px;border-bottom:1px solid #1f1f24;}
.table-wrap .th span{font-family:ui-monospace,monospace;}
.tbody-scroll{max-height:280px;overflow:hidden;}
#dataTable{width:100%;border-collapse:collapse;font-family:ui-monospace,monospace;font-size:13px;}
#dataTable td{padding:5px 6px;color:#e5e5e5;border-bottom:1px solid #15151b;width:50%;text-align:left;}
#dataTable tr.new{background:rgba(99,102,241,.18);transition:background 1s;}
#dataTable tr.new td{color:#e0e7ff;}
#dataTable tr.faded td{color:#52525b;}
.t-foot{margin-top:auto;padding-top:8px;font-size:11px;color:#71717a;border-top:1px solid #1f1f24;}
.t-foot span{color:#c4b5fd;font-family:ui-monospace,monospace;}

.plot-wrap{position:relative;padding:8px;}
#plot{display:block;width:100%;height:auto;}
#points circle{fill:#fbbf24;stroke:#0a0a0d;stroke-width:1.5;transition:r .25s,filter .3s;}
#points circle.flash{filter:drop-shadow(0 0 6px rgba(251,191,36,0.9));}
#points circle.noisy{fill:#f43f5e;}
#trendLine{filter:drop-shadow(0 0 4px rgba(129,140,248,.4));}

.below{margin-top:16px;}
`;

const LAD_JS = `
const POINTS = [
  {x:1.0,y:1.4},{x:2.0,y:2.1},{x:2.7,y:2.0},
  {x:3.5,y:3.4},{x:4.2,y:3.1},{x:5.0,y:4.6},
  {x:5.8,y:4.2},{x:6.6,y:5.5},{x:7.5,y:6.1},
  {x:8.4,y:6.8},
];
const NOISIEST_IDX = 5; // (5.0, 4.6) — largest residual from the trend
const TREND = { m: 0.667, b: 0.633 };

const X_MIN=0,X_MAX=10,Y_MIN=-1,Y_MAX=9;
const PAD_L=48,PAD_R=20,PAD_T=20,PAD_B=40;
const W=520,H=320;
const sx=(x)=>PAD_L+(x-X_MIN)/(X_MAX-X_MIN)*(W-PAD_L-PAD_R);
const sy=(y)=>H-PAD_B-(y-Y_MIN)/(Y_MAX-Y_MIN)*(H-PAD_T-PAD_B);

const gridG=document.getElementById('grid');
for(let gx=0;gx<=10;gx+=2){
  const ln=document.createElementNS('http://www.w3.org/2000/svg','line');
  ln.setAttribute('x1',sx(gx));ln.setAttribute('x2',sx(gx));
  ln.setAttribute('y1',sy(Y_MIN));ln.setAttribute('y2',sy(Y_MAX));
  ln.setAttribute('stroke','#15151b');ln.setAttribute('stroke-width','1');
  gridG.appendChild(ln);
}
for(let gy=0;gy<=8;gy+=2){
  const ln=document.createElementNS('http://www.w3.org/2000/svg','line');
  ln.setAttribute('x1',sx(X_MIN));ln.setAttribute('x2',sx(X_MAX));
  ln.setAttribute('y1',sy(gy));ln.setAttribute('y2',sy(gy));
  ln.setAttribute('stroke','#15151b');ln.setAttribute('stroke-width','1');
  gridG.appendChild(ln);
}

// Build all 10 dots up front (radius 0 = invisible). We toggle r per step.
const ptsG=document.getElementById('points');
const circles = POINTS.map((p,i)=>{
  const c=document.createElementNS('http://www.w3.org/2000/svg','circle');
  c.setAttribute('cx',sx(p.x));c.setAttribute('cy',sy(p.y));
  c.setAttribute('r',0);
  c.dataset.i = String(i);
  ptsG.appendChild(c);
  return c;
});

const els = {
  tbody: document.getElementById('tbody'),
  rowCount: document.getElementById('rowCount'),
  trendLine: document.getElementById('trendLine'),
  trendBadge: document.getElementById('trendBadge'),
  spreadBand: document.getElementById('spreadBand'),
  noisyHalo: document.getElementById('noisyHalo'),
  narrative: document.getElementById('narrative'),
  stepTitle: document.getElementById('stepTitle'),
  stepNum: document.getElementById('stepNum'),
  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),
  restartBtn: document.getElementById('restartBtn'),
  dots: Array.from(document.querySelectorAll('.dots .dot')),
};

function show(el){ el.classList.remove('hidden'); }
function hide(el){ el.classList.add('hidden'); }

// Pre-position trend line and spread band based on TREND (m, b)
{
  const x1 = X_MIN, x2 = X_MAX;
  const y1 = TREND.m*x1+TREND.b, y2 = TREND.m*x2+TREND.b;
  els.trendLine.setAttribute('x1', sx(x1));
  els.trendLine.setAttribute('y1', sy(y1));
  els.trendLine.setAttribute('x2', sx(x2));
  els.trendLine.setAttribute('y2', sy(y2));
  // spread band = trend ± 0.7
  const off = 0.7;
  const path = 'M '+sx(x1)+' '+sy(y1+off)
             +' L '+sx(x2)+' '+sy(y2+off)
             +' L '+sx(x2)+' '+sy(y2-off)
             +' L '+sx(x1)+' '+sy(y1-off)+' Z';
  els.spreadBand.setAttribute('d', path);
  // halo on noisiest point
  const np = POINTS[NOISIEST_IDX];
  els.noisyHalo.setAttribute('cx', sx(np.x));
  els.noisyHalo.setAttribute('cy', sy(np.y));
}

// Track scheduled timers so we can cancel on step change
let timers = [];
function clearTimers(){ timers.forEach(t=>clearTimeout(t)); timers = []; }
function later(fn, ms){ const t = setTimeout(fn, ms); timers.push(t); return t; }

function setRowCount(n){
  els.rowCount.textContent = n + ' / ' + POINTS.length;
}

function resetTable(){
  els.tbody.innerHTML = '';
  setRowCount(0);
}

function addRow(i, opts){
  opts = opts || {};
  const tr = document.createElement('tr');
  const tdX = document.createElement('td'); tdX.textContent = POINTS[i].x.toFixed(1);
  const tdY = document.createElement('td'); tdY.textContent = POINTS[i].y.toFixed(1);
  tr.appendChild(tdX); tr.appendChild(tdY);
  tr.dataset.i = String(i);
  if (opts.faded) tr.classList.add('faded');
  els.tbody.appendChild(tr);
  if (opts.flash){
    tr.classList.add('new');
    later(()=>tr.classList.remove('new'), 900);
  }
  setRowCount(els.tbody.children.length);
}

function showDot(i, opts){
  opts = opts || {};
  const c = circles[i];
  c.setAttribute('r', 4.5);
  if (opts.flash){
    c.classList.add('flash');
    later(()=>c.classList.remove('flash'), 700);
  }
}

function hideAllDots(){
  circles.forEach(c => c.setAttribute('r', 0));
  circles.forEach(c => c.classList.remove('flash','noisy'));
}

function showAllDotsAndRowsImmediate(){
  resetTable();
  hideAllDots();
  POINTS.forEach((_, i) => {
    addRow(i);
    showDot(i);
  });
}

const STEPS = [
  {
    n: 1,
    title: 'One row, one point',
    body: '<h2>An observation is two numbers</h2>'
        + '<p>Real datasets are tables. Each row is one observation — for us, a pair: an <b>x</b> value and a <b>y</b> value. Maybe x is study hours and y is exam score. Every vertical gap between a point and the trend line you eventually draw is called a <em>residual</em> — that is what regression actually measures.</p>'
        + '<p>The plot on the right will hold one yellow dot per row. Watch: the first row appears in the table, then the matching dot pops onto the chart.</p>'
        + '<div class="tip">Highlight <em>residual</em> above and click Explain to open a child lesson that zooms into how regression turns those gaps into a single error number.</div>',
    enter(){
      hide(els.trendLine); hide(els.trendBadge);
      hide(els.spreadBand); hide(els.noisyHalo);
      resetTable();
      hideAllDots();
      later(()=>{ addRow(0, { flash: true }); showDot(0, { flash: true }); }, 280);
    },
  },
  {
    n: 2,
    title: 'A whole dataset is a cloud of points',
    body: '<h2>Many rows, many dots</h2>'
        + '<p>One observation is a single dot — and one dot tells you almost nothing. <b>Many</b> observations together start to show a shape.</p>'
        + '<p>Watch all ten rows stream in. Each row in the table fires a dot onto the plot in the same order. The table tells you the numbers; the plot tells you the <em>shape</em>.</p>',
    enter(){
      hide(els.trendLine); hide(els.trendBadge);
      hide(els.spreadBand); hide(els.noisyHalo);
      resetTable();
      hideAllDots();
      POINTS.forEach((_, i) => {
        later(()=>{ addRow(i, { flash: true }); showDot(i, { flash: true }); }, 200 + i*200);
      });
    },
  },
  {
    n: 3,
    title: 'Look for the trend',
    body: '<h2>What direction do the points go?</h2>'
        + '<p>The first question to ask any scatter plot: <b>do x and y move together?</b></p>'
        + '<p>Here, as x grows, y grows too — that is a <em>positive trend</em>. The dashed indigo line shows the rough direction of that trend. A line model is going to be a reasonable fit, because the cloud has a clear linear direction.</p>'
        + '<p>If the cloud went down-and-to-the-right, it would be a <em>negative</em> trend. If it scattered with no direction, a line would be a bad model.</p>',
    enter(){
      hide(els.spreadBand); hide(els.noisyHalo);
      showAllDotsAndRowsImmediate();
      show(els.trendLine);
      show(els.trendBadge);
    },
  },
  {
    n: 4,
    title: 'Spread and noise',
    body: '<h2>Real data never sits exactly on the line</h2>'
        + '<p>The shaded indigo band is the typical <b>spread</b> — how far points stray from the trend. Each vertical gap from a point to the trend is called a <em>residual</em>: literally the leftover error your line could not explain. Tight band, small residuals; wide band, big residuals.</p>'
        + '<p>The red ring marks the <em>noisiest</em> observation — the one with the largest residual in this set. Real datasets always have points like this; the job of regression is to find a line that is good <b>on average</b>, not perfect on every point.</p>'
        + '<div class="tip">Highlight <em>residuals</em> above and click Explain to see how regression turns every gap into a single error number (SSE).</div>',
    enter(){
      showAllDotsAndRowsImmediate();
      show(els.trendLine);
      show(els.trendBadge);
      show(els.spreadBand);
      show(els.noisyHalo);
      circles[NOISIEST_IDX].classList.add('noisy');
    },
  },
];

let cur = 1;

function goto(n){
  clearTimers();
  cur = Math.max(1, Math.min(STEPS.length, n));
  const step = STEPS[cur-1];
  step.enter();
  els.stepTitle.textContent = step.title;
  els.narrative.innerHTML = step.body;
  els.stepNum.textContent = String(cur);
  els.dots.forEach((d,i)=>{
    d.classList.toggle('active', i+1 === cur);
    d.classList.toggle('done', i+1 < cur);
  });
  els.prevBtn.disabled = cur === 1;
  if (cur === STEPS.length){
    els.nextBtn.classList.add('hidden');
    els.restartBtn.classList.remove('hidden');
  } else {
    els.nextBtn.classList.remove('hidden');
    els.restartBtn.classList.add('hidden');
  }
}

els.prevBtn.addEventListener('click', ()=>goto(cur-1));
els.nextBtn.addEventListener('click', ()=>goto(cur+1));
els.restartBtn.addEventListener('click', ()=>goto(1));

goto(1);
`;

// ─────────────────────────────────────────────────────────────────
// Lesson 3 — "Residuals" (typically a child of Look-at-data or LR)
// ─────────────────────────────────────────────────────────────────
const RES_HTML = `
<header class="lh">
  <div class="dots" role="progressbar" aria-valuemin="1" aria-valuemax="4" aria-valuenow="1">
    <span class="dot active" data-step="1"></span>
    <span class="dot" data-step="2"></span>
    <span class="dot" data-step="3"></span>
    <span class="dot" data-step="4"></span>
  </div>
  <h1 id="stepTitle">What is a residual?</h1>
  <p class="kicker">Residuals · turning every gap into one error number</p>
</header>

<div class="stage">
  <div class="plot-wrap card">
    <svg id="plot" viewBox="0 0 520 320" preserveAspectRatio="xMidYMid meet" aria-label="Scatter plot with trend line and residuals">
      <defs>
        <linearGradient id="trendGrad" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stop-color="#818cf8" stop-opacity="0.85"/>
          <stop offset="100%" stop-color="#a78bfa" stop-opacity="0.85"/>
        </linearGradient>
      </defs>
      <g id="grid"></g>
      <g id="axes">
        <line x1="48" y1="280" x2="500" y2="280" stroke="#2a2a32" stroke-width="1"/>
        <line x1="48" y1="20" x2="48" y2="280" stroke="#2a2a32" stroke-width="1"/>
        <text x="496" y="298" text-anchor="end" fill="#71717a" font-size="11" font-family="ui-monospace,monospace">x</text>
        <text x="32" y="26" text-anchor="end" fill="#71717a" font-size="11" font-family="ui-monospace,monospace">y</text>
      </g>
      <line id="trendLine" stroke="url(#trendGrad)" stroke-width="2.5" stroke-linecap="round"/>
      <g id="residuals"></g>
      <g id="points"></g>
      <circle id="hlRing" class="hidden" r="14" fill="none" stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="2 3"/>
      <g id="resLabel" class="hidden"></g>
    </svg>
  </div>
  <aside class="side">
    <div id="narrative" class="narrative card"></div>
  </aside>
</div>

<div id="barWrap" class="bar-wrap card hidden">
  <div class="bar-head">
    <h3 id="barTitle">Residuals · sign tells direction, size tells magnitude</h3>
    <div class="bar-readout">
      <span class="lbl">SSE</span>
      <span class="val mono" id="sseVal">—</span>
    </div>
  </div>
  <svg id="bars" viewBox="0 0 520 200" preserveAspectRatio="xMidYMid meet">
    <line id="barAxis" x1="48" y1="100" x2="500" y2="100" stroke="#2a2a32" stroke-width="1"/>
    <text x="44" y="22" text-anchor="end" fill="#71717a" font-size="10" font-family="ui-monospace,monospace">+</text>
    <text x="44" y="184" text-anchor="end" fill="#71717a" font-size="10" font-family="ui-monospace,monospace">−</text>
    <g id="barGroup"></g>
  </svg>
</div>

<footer class="lf">
  <button id="prevBtn" class="btn-ghost" disabled>← Back</button>
  <span class="step-count">Step <span id="stepNum">1</span> of 4</span>
  <button id="nextBtn" class="btn-primary">Next →</button>
  <button id="restartBtn" class="btn-ghost hidden">Restart</button>
</footer>
`;

const RES_CSS = SHARED_CSS + `
.stage{display:grid;grid-template-columns:1.55fr 1fr;gap:16px;align-items:start;}
@media (max-width: 760px){ .stage{grid-template-columns:1fr;} }

.plot-wrap{position:relative;padding:8px;}
#plot{display:block;width:100%;height:auto;}
#points circle{fill:#fbbf24;stroke:#0a0a0d;stroke-width:1.5;transition:opacity .3s,r .25s;}
#points circle.dim{opacity:0.32;}
#residuals line{stroke:#f43f5e;stroke-width:1.4;stroke-dasharray:3 3;opacity:0.9;transition:opacity .3s;}
#residuals line.dim{opacity:0.18;}
#trendLine{filter:drop-shadow(0 0 6px rgba(129,140,248,.35));}

.bar-wrap{margin-top:16px;padding:14px 16px;}
.bar-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px;}
.bar-head h3{margin:0;font-size:13px;color:#d4d4d8;font-weight:500;}
.bar-readout{display:inline-flex;align-items:center;gap:8px;padding:5px 10px;background:#15151b;border:1px solid #1f1f24;border-radius:999px;font-size:12px;}
.bar-readout .lbl{color:#71717a;text-transform:uppercase;letter-spacing:.08em;font-size:10px;}
.bar-readout .val{color:#e5e5e5;}
.bar-readout .val.mono{font-family:ui-monospace,monospace;}
.bar-readout .val.flash{color:#a78bfa;transition:color .4s;}

#bars{display:block;width:100%;height:auto;}
.bar-rect{transition:y .55s cubic-bezier(.4,0,.2,1), height .55s cubic-bezier(.4,0,.2,1), fill .55s ease;}

.side{display:grid;gap:14px;}
`;

const RES_JS = `
const POINTS = [
  {x:1.0,y:1.4},{x:2.0,y:2.1},{x:2.7,y:2.0},
  {x:3.5,y:3.4},{x:4.2,y:3.1},{x:5.0,y:4.6},
  {x:5.8,y:4.2},{x:6.6,y:5.5},{x:7.5,y:6.1},
  {x:8.4,y:6.8},
];
const TREND = { m: 0.667, b: 0.633 };
const HL_IDX = 5; // (5.0, 4.6) — biggest residual, makes step 1 visually clear
const RESIDUALS = POINTS.map(p => p.y - (TREND.m*p.x + TREND.b));
const SSE_TOTAL = RESIDUALS.reduce((s, r) => s + r*r, 0);

const X_MIN=0,X_MAX=10,Y_MIN=-1,Y_MAX=9;
const PAD_L=48,PAD_R=20,PAD_T=20,PAD_B=40;
const W=520,H=320;
const sx=(x)=>PAD_L+(x-X_MIN)/(X_MAX-X_MIN)*(W-PAD_L-PAD_R);
const sy=(y)=>H-PAD_B-(y-Y_MIN)/(Y_MAX-Y_MIN)*(H-PAD_T-PAD_B);

const gridG=document.getElementById('grid');
for(let gx=0;gx<=10;gx+=2){
  const ln=document.createElementNS('http://www.w3.org/2000/svg','line');
  ln.setAttribute('x1',sx(gx));ln.setAttribute('x2',sx(gx));
  ln.setAttribute('y1',sy(Y_MIN));ln.setAttribute('y2',sy(Y_MAX));
  ln.setAttribute('stroke','#15151b');ln.setAttribute('stroke-width','1');
  gridG.appendChild(ln);
}
for(let gy=0;gy<=8;gy+=2){
  const ln=document.createElementNS('http://www.w3.org/2000/svg','line');
  ln.setAttribute('x1',sx(X_MIN));ln.setAttribute('x2',sx(X_MAX));
  ln.setAttribute('y1',sy(gy));ln.setAttribute('y2',sy(gy));
  ln.setAttribute('stroke','#15151b');ln.setAttribute('stroke-width','1');
  gridG.appendChild(ln);
}

// trend line
{
  const tx1=X_MIN, tx2=X_MAX;
  const ty1=TREND.m*tx1+TREND.b, ty2=TREND.m*tx2+TREND.b;
  const t=document.getElementById('trendLine');
  t.setAttribute('x1',sx(tx1)); t.setAttribute('y1',sy(ty1));
  t.setAttribute('x2',sx(tx2)); t.setAttribute('y2',sy(ty2));
}

// scatter points
const ptsG=document.getElementById('points');
const circles = POINTS.map((p,i)=>{
  const c=document.createElementNS('http://www.w3.org/2000/svg','circle');
  c.setAttribute('cx',sx(p.x));c.setAttribute('cy',sy(p.y));
  c.setAttribute('r',4.5);
  c.dataset.i = String(i);
  ptsG.appendChild(c);
  return c;
});

// residual lines (point → predicted-y on the trend)
const resG=document.getElementById('residuals');
const resLines = POINTS.map((p)=>{
  const yhat = TREND.m*p.x + TREND.b;
  const ln=document.createElementNS('http://www.w3.org/2000/svg','line');
  ln.setAttribute('x1',sx(p.x)); ln.setAttribute('x2',sx(p.x));
  ln.setAttribute('y1',sy(p.y)); ln.setAttribute('y2',sy(yhat));
  resG.appendChild(ln);
  return ln;
});

// highlight ring + tooltip on the focused point (used in step 1)
const hlRing = document.getElementById('hlRing');
const resLabel = document.getElementById('resLabel');
{
  const p = POINTS[HL_IDX];
  hlRing.setAttribute('cx', sx(p.x));
  hlRing.setAttribute('cy', sy(p.y));
  const labelX = sx(p.x) + 14;
  const labelY = (sy(p.y) + sy(TREND.m*p.x+TREND.b)) / 2 - 12;
  const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
  rect.setAttribute('x', labelX); rect.setAttribute('y', labelY);
  rect.setAttribute('width', 110); rect.setAttribute('height', 22);
  rect.setAttribute('rx', 11);
  rect.setAttribute('fill', 'rgba(244,63,94,0.18)');
  rect.setAttribute('stroke', 'rgba(244,63,94,0.45)');
  const text = document.createElementNS('http://www.w3.org/2000/svg','text');
  text.setAttribute('x', labelX + 10); text.setAttribute('y', labelY + 15);
  text.setAttribute('fill', '#fda4af');
  text.setAttribute('font-size', 11);
  text.setAttribute('font-family', 'ui-monospace,monospace');
  text.textContent = 'residual = ' + (RESIDUALS[HL_IDX] >= 0 ? '+' : '') + RESIDUALS[HL_IDX].toFixed(2);
  resLabel.appendChild(rect);
  resLabel.appendChild(text);
}

// bar chart (signed → squared)
const barGroup = document.getElementById('barGroup');
const barTitle = document.getElementById('barTitle');
const sseVal = document.getElementById('sseVal');
const BAR_BASELINE = 100;
const SCALE_SIGNED = 110;   // px per unit residual
const SCALE_SQ     = 200;   // px per unit residual²
const BAR_W = 30, BAR_GAP = 12, BAR_X0 = 56;
const bars = POINTS.map((_, i) => {
  const r = document.createElementNS('http://www.w3.org/2000/svg','rect');
  r.classList.add('bar-rect');
  r.setAttribute('x', BAR_X0 + i*(BAR_W+BAR_GAP));
  r.setAttribute('width', BAR_W);
  r.setAttribute('y', BAR_BASELINE);
  r.setAttribute('height', 0);
  r.setAttribute('rx', 3);
  r.setAttribute('fill', '#3f3f46');
  barGroup.appendChild(r);
  return r;
});

function setBars(mode){
  RESIDUALS.forEach((r, i) => {
    let y, h, fill;
    if (mode === 'signed'){
      h = Math.abs(r) * SCALE_SIGNED;
      y = r > 0 ? BAR_BASELINE - h : BAR_BASELINE;
      fill = r > 0 ? '#818cf8' : '#f43f5e';
    } else {
      h = (r*r) * SCALE_SQ;
      y = BAR_BASELINE - h;
      fill = '#fbbf24';
    }
    bars[i].setAttribute('y', y);
    bars[i].setAttribute('height', h);
    bars[i].setAttribute('fill', fill);
  });
  if (mode === 'signed'){
    barTitle.textContent = 'Residuals · sign tells direction, size tells magnitude';
    sseVal.textContent = '—';
  } else {
    barTitle.textContent = 'Squared residuals — all positive, big errors hurt more';
    sseVal.textContent = SSE_TOTAL.toFixed(2);
    sseVal.classList.add('flash');
    setTimeout(()=>sseVal.classList.remove('flash'), 800);
  }
}

const els = {
  hlRing, resLabel,
  barWrap: document.getElementById('barWrap'),
  narrative: document.getElementById('narrative'),
  stepTitle: document.getElementById('stepTitle'),
  stepNum: document.getElementById('stepNum'),
  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),
  restartBtn: document.getElementById('restartBtn'),
  dots: Array.from(document.querySelectorAll('.dots .dot')),
};

function show(el){ el.classList.remove('hidden'); }
function hide(el){ el.classList.add('hidden'); }

function dimAllExcept(idx){
  circles.forEach((c, i) => c.classList.toggle('dim', i !== idx));
  resLines.forEach((ln, i) => ln.classList.toggle('dim', i !== idx));
}
function showAll(){
  circles.forEach(c => c.classList.remove('dim'));
  resLines.forEach(ln => ln.classList.remove('dim'));
}

const STEPS = [
  {
    n: 1, title: 'What is a residual?',
    body: '<h2>Just the gap, point to line</h2>'
        + '<p>Pick any point on the plot. The trend line predicts a y value for its x: just plug x into y = mx + b. That prediction is called <b>ŷ</b> (&ldquo;y-hat&rdquo;).</p>'
        + '<p>The <b>residual</b> for that point is what the data actually was, minus what the line predicted: <em>residual = y − ŷ</em>. The dashed red bar shows the gap. Positive means the point sits above the line; negative means below.</p>',
    enter(){
      dimAllExcept(HL_IDX);
      show(hlRing);
      show(resLabel);
      hide(els.barWrap);
    },
  },
  {
    n: 2, title: 'Every observation has one',
    body: '<h2>One residual per point</h2>'
        + '<p>Now look at the whole dataset. Every point has its own residual — its own little dashed line connecting it to the trend.</p>'
        + '<p>Some points sit <b>above</b> the line (positive residuals), some sit <b>below</b> (negative). Together, the collection of residuals tells you, point by point, where your model is over-predicting and where it is under-predicting.</p>',
    enter(){
      showAll();
      hide(hlRing);
      hide(resLabel);
      hide(els.barWrap);
    },
  },
  {
    n: 3, title: 'Stack them as bars',
    body: '<h2>Sign tells direction, size tells magnitude</h2>'
        + '<p>The bar chart below shows every residual as a bar. <b style="color:#818cf8">Indigo bars</b> point up — points above the line. <b style="color:#f43f5e">Red bars</b> point down — points below.</p>'
        + '<p>If you just <em>added them up</em>, the positives and negatives would partly cancel, hiding how wrong the line really is. We need a way to make every miss count.</p>',
    enter(){
      showAll();
      hide(hlRing);
      hide(resLabel);
      show(els.barWrap);
      setBars('signed');
    },
  },
  {
    n: 4, title: 'Square them, sum them: SSE',
    body: '<h2>Sum of Squared Errors</h2>'
        + '<p>Square every residual. The bars all flip up (negatives are gone), and big residuals get punished harder — a residual of 0.6 squared is 0.36, but 1.2 squared is 1.44, four times as costly.</p>'
        + "<p>Add the squared bars together and you get <b>SSE</b>: the sum of squared errors. One number that says &ldquo;how wrong is this line, overall.&rdquo; <em>Linear regression's entire job is finding the line that makes SSE as small as possible.</em></p>",
    enter(){
      showAll();
      hide(hlRing);
      hide(resLabel);
      show(els.barWrap);
      setBars('squared');
    },
  },
];

let cur = 1;

function goto(n){
  cur = Math.max(1, Math.min(STEPS.length, n));
  const step = STEPS[cur-1];
  step.enter();
  els.stepTitle.textContent = step.title;
  els.narrative.innerHTML = step.body;
  els.stepNum.textContent = String(cur);
  els.dots.forEach((d,i)=>{
    d.classList.toggle('active', i+1 === cur);
    d.classList.toggle('done', i+1 < cur);
  });
  els.prevBtn.disabled = cur === 1;
  if (cur === STEPS.length){
    els.nextBtn.classList.add('hidden');
    els.restartBtn.classList.remove('hidden');
  } else {
    els.nextBtn.classList.remove('hidden');
    els.restartBtn.classList.add('hidden');
  }
}

els.prevBtn.addEventListener('click', ()=>goto(cur-1));
els.nextBtn.addEventListener('click', ()=>goto(cur+1));
els.restartBtn.addEventListener('click', ()=>goto(1));

goto(1);
`;

// ─────────────────────────────────────────────────────────────────
// Lesson 4 — "Linear Regression Quiz" (interactive visual quiz)
// ─────────────────────────────────────────────────────────────────
const QUIZ_HTML = `
<header class="lh">
  <div class="dots" role="progressbar" aria-valuemin="1" aria-valuemax="4" aria-valuenow="1">
    <span class="dot active" data-q="1"></span>
    <span class="dot" data-q="2"></span>
    <span class="dot" data-q="3"></span>
    <span class="dot" data-q="4"></span>
  </div>
  <h1>Linear Regression — Quick Check</h1>
  <p class="kicker">Interactive quiz · 4 visual questions · drag, click, decide</p>
</header>

<div class="qz-stage" id="qzStage">
  <div class="qz-prompt card">
    <div class="qz-meta">
      <span class="qz-tag">Q<span id="qIdx">1</span></span>
      <span class="qz-kind" id="qKind">Click the line</span>
    </div>
    <p id="promptText">Three candidate lines run through the same scatter. Which one fits best?</p>
    <div class="qz-feedback hidden" id="qFeedback"></div>
  </div>

  <div class="qz-chart card" id="chartWrap">
    <svg id="qsvg" viewBox="0 0 520 320" preserveAspectRatio="xMidYMid meet" aria-label="Quiz scatter plot">
      <defs>
        <linearGradient id="qLineGrad" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stop-color="#818cf8"/>
          <stop offset="100%" stop-color="#a78bfa"/>
        </linearGradient>
      </defs>
      <g id="qgrid"></g>
      <g id="qaxes">
        <line x1="48" y1="280" x2="500" y2="280" stroke="#2a2a32" stroke-width="1"/>
        <line x1="48" y1="20" x2="48" y2="280" stroke="#2a2a32" stroke-width="1"/>
        <text x="496" y="298" text-anchor="end" fill="#71717a" font-size="11" font-family="ui-monospace,monospace">x</text>
        <text x="32" y="26" text-anchor="end" fill="#71717a" font-size="11" font-family="ui-monospace,monospace">y</text>
      </g>
      <g id="qresiduals"></g>
      <g id="qlines"></g>
      <g id="qpoints"></g>
      <g id="qmarker"></g>
    </svg>
    <div class="qz-readout" id="qReadout"></div>
  </div>

  <div class="qz-ctrl card" id="ctrlCard">
    <!-- per-question controls injected by JS -->
  </div>
</div>

<div class="qz-results hidden" id="resultsScreen">
  <div class="qz-score-card card">
    <div class="qz-score-row">
      <div class="qz-score-num"><span id="scoreNum">0</span><span class="qz-sep">/</span><span class="qz-tot">4</span></div>
      <div class="qz-score-blurb">
        <h2 id="scoreHeadline">Nice work!</h2>
        <p id="scoreLabel">—</p>
      </div>
    </div>
    <ul class="qz-recap" id="qResults"></ul>
    <div class="qz-actions">
      <button id="qRestart" class="btn-primary">Try again</button>
    </div>
  </div>
</div>

<div class="lf" id="qFooter">
  <button id="qPrev" class="btn-ghost" disabled>Back</button>
  <span class="step-count">Question <span id="qIdxFoot">1</span> / 4</span>
  <button id="qNext" class="btn-primary" disabled>Check</button>
</div>
`;

const QUIZ_CSS = SHARED_CSS + `
.qz-stage{display:grid;grid-template-columns:0.55fr 1.3fr 0.55fr;gap:12px;align-items:start;}
@media (max-width: 900px){ .qz-stage{grid-template-columns:1fr;} }

.qz-prompt{padding:14px 16px;display:flex;flex-direction:column;gap:10px;min-height:240px;}
.qz-meta{display:flex;align-items:center;gap:8px;}
.qz-tag{display:inline-flex;align-items:center;justify-content:center;min-width:28px;padding:3px 8px;border-radius:999px;font-family:ui-monospace,monospace;font-size:11px;color:#c4b5fd;background:rgba(99,102,241,.14);border:1px solid rgba(129,140,248,.3);}
.qz-kind{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#71717a;}
.qz-prompt p{margin:0;color:#d4d4d8;font-size:14px;line-height:1.55;}
.qz-feedback{margin-top:auto;padding:10px 12px;border-radius:8px;font-size:13px;line-height:1.5;border-left:3px solid;}
.qz-feedback.ok{background:rgba(34,197,94,.08);border-color:#22c55e;color:#bbf7d0;}
.qz-feedback.bad{background:rgba(244,63,94,.08);border-color:#f43f5e;color:#fecdd3;}
.qz-feedback b{color:#fff;}

.qz-chart{position:relative;padding:8px;}
#qsvg{display:block;width:100%;height:auto;}
#qpoints circle{fill:#fbbf24;stroke:#0a0a0d;stroke-width:1.5;transition:r .2s,filter .25s;}
#qpoints circle.clickable{cursor:pointer;}
#qpoints circle.clickable:hover{r:6.5;filter:drop-shadow(0 0 5px rgba(251,191,36,.7));}
#qpoints circle.picked{fill:#22d3ee;}
#qpoints circle.correct{fill:#34d399;filter:drop-shadow(0 0 8px rgba(52,211,153,.85));}
#qpoints circle.wrong{fill:#f87171;filter:drop-shadow(0 0 8px rgba(248,113,113,.7));}

#qlines path,#qlines line{fill:none;cursor:pointer;transition:stroke-width .15s,filter .25s,opacity .25s;}
#qlines .qline{stroke:#3f3f46;stroke-width:2.5;stroke-linecap:round;}
#qlines .qline.hover{stroke:#a78bfa;stroke-width:3;}
#qlines .qline.picked{stroke:url(#qLineGrad);stroke-width:3.5;filter:drop-shadow(0 0 6px rgba(167,139,250,.4));}
#qlines .qline.correct{stroke:#34d399;stroke-width:3.5;filter:drop-shadow(0 0 8px rgba(52,211,153,.6));}
#qlines .qline.wrong{stroke:#f43f5e;stroke-width:3;opacity:.55;}

#qresiduals line{stroke:#f43f5e;stroke-width:1.2;stroke-dasharray:3 3;opacity:.7;pointer-events:none;}
#qresiduals line.qhilite{stroke:#fbbf24;stroke-width:2;opacity:1;stroke-dasharray:0;}

#qmarker line{stroke:#22d3ee;stroke-width:1.4;stroke-dasharray:4 4;}
#qmarker circle{fill:#22d3ee;stroke:#0a0a0d;stroke-width:1.5;}
#qmarker text{fill:#67e8f9;font-family:ui-monospace,monospace;font-size:11px;}

.qz-readout{position:absolute;top:14px;right:14px;display:flex;flex-direction:column;gap:6px;align-items:flex-end;pointer-events:none;}
.qz-readout .pill{display:inline-flex;align-items:center;gap:8px;padding:5px 10px;background:rgba(15,15,20,.85);border:1px solid #1f1f24;border-radius:999px;backdrop-filter:blur(6px);font-size:12px;}
.qz-readout .pill .lbl{color:#71717a;text-transform:uppercase;letter-spacing:.08em;font-size:10px;}
.qz-readout .pill .val{color:#e5e5e5;font-family:ui-monospace,monospace;}
.qz-readout .pill .val.good{color:#86efac;}
.qz-readout .pill .val.warn{color:#fcd34d;}
.qz-readout .pill .val.bad{color:#fda4af;}

.qz-ctrl{padding:14px 16px;display:flex;flex-direction:column;gap:10px;min-height:240px;}
.qz-ctrl h3{margin:0;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#71717a;font-weight:500;}
.qz-ctrl .help{font-size:12px;color:#a1a1aa;line-height:1.5;margin:0;}
.qz-ctrl .help code{background:#15151b;color:#c4b5fd;padding:1px 6px;border-radius:5px;font-size:11px;}

.qz-options{display:grid;gap:8px;}
.qz-option{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#0e0e12;border:1px solid #1f1f24;border-radius:10px;cursor:pointer;transition:border-color .15s,background .15s;color:#d4d4d8;font-size:13px;text-align:left;}
.qz-option:hover{border-color:#3a3a42;background:#15151b;}
.qz-option.picked{border-color:#818cf8;background:rgba(99,102,241,.10);color:#e0e7ff;}
.qz-option.picked .qz-swatch{box-shadow:0 0 0 3px rgba(129,140,248,.25);}
.qz-option.correct{border-color:#22c55e;background:rgba(34,197,94,.08);color:#dcfce7;}
.qz-option.wrong{border-color:#f43f5e;background:rgba(244,63,94,.08);color:#fecdd3;}
.qz-option.disabled{cursor:default;opacity:.6;}
.qz-swatch{width:18px;height:3px;border-radius:2px;flex-shrink:0;transition:box-shadow .2s;}

.qz-slider-row{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;}
.qz-slider-row label{font-size:12px;color:#a1a1aa;font-family:ui-monospace,monospace;}
.qz-slider-row output{font-family:ui-monospace,monospace;font-size:12px;color:#e5e5e5;background:#15151b;padding:3px 8px;border-radius:6px;min-width:48px;text-align:center;}
.qz-slider-row input[type=range]{accent-color:#818cf8;width:100%;}

.qz-sse-bar{margin-top:6px;}
.qz-sse-bar .lbl{display:flex;justify-content:space-between;font-size:11px;color:#71717a;margin-bottom:4px;text-transform:uppercase;letter-spacing:.08em;}
.qz-sse-bar .lbl .target{color:#86efac;}
.qz-sse-bar .track{height:8px;background:#15151b;border-radius:999px;overflow:hidden;border:1px solid #1f1f24;position:relative;}
.qz-sse-bar .fill{height:100%;background:linear-gradient(90deg,#22c55e,#fbbf24,#f43f5e);transition:width .25s;width:60%;}
.qz-sse-bar .target-marker{position:absolute;top:-2px;bottom:-2px;width:2px;background:#34d399;}

.qz-results{margin-top:14px;}
.qz-results.hidden{display:none;}
.qz-score-card{padding:24px;display:flex;flex-direction:column;gap:18px;}
.qz-score-row{display:flex;align-items:center;gap:20px;}
.qz-score-num{font-family:ui-monospace,monospace;font-size:46px;line-height:1;color:#c4b5fd;letter-spacing:-0.02em;}
.qz-score-num .qz-sep{color:#3f3f46;margin:0 4px;}
.qz-score-num .qz-tot{color:#71717a;}
.qz-score-blurb h2{margin:0 0 4px;color:#e0e7ff;font-size:18px;}
.qz-score-blurb p{margin:0;color:#a1a1aa;font-size:13px;}
.qz-recap{list-style:none;padding:0;margin:0;display:grid;gap:8px;}
.qz-recap li{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#0e0e12;border:1px solid #1f1f24;border-radius:8px;font-size:13px;color:#d4d4d8;}
.qz-recap li .check{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:999px;font-size:13px;font-weight:600;}
.qz-recap li.ok .check{background:rgba(34,197,94,.12);color:#86efac;border:1px solid rgba(52,211,153,.3);}
.qz-recap li.bad .check{background:rgba(244,63,94,.12);color:#fda4af;border:1px solid rgba(244,63,94,.3);}
.qz-recap li .qkind{flex:1;}
.qz-recap li .qresult{font-family:ui-monospace,monospace;font-size:11px;color:#71717a;}
.qz-actions{display:flex;justify-content:flex-end;}
.qz-actions .btn-primary{padding:10px 18px;}

.qz-stage.hidden{display:none;}
#qFooter.hidden{display:none;}
`;

const QUIZ_JS = `
const POINTS = [
  {x:1.0,y:1.4},{x:2.0,y:1.9},{x:3.0,y:3.5},{x:4.0,y:3.2},
  {x:5.0,y:4.6},{x:6.0,y:5.1},{x:7.0,y:6.0},{x:8.0,y:7.4},
  {x:9.0,y:7.9},{x:10.0,y:8.7},
];
const TRUE = { m: 0.81, b: 0.59 }; // np.polyfit on the 10 points
const X_MIN=0,X_MAX=11,Y_MIN=-0.5,Y_MAX=10;
const PAD_L=48,PAD_R=20,PAD_T=20,PAD_B=40;
const W=520,H=320;
const sx=(x)=>PAD_L+(x-X_MIN)/(X_MAX-X_MIN)*(W-PAD_L-PAD_R);
const sy=(y)=>H-PAD_B-(y-Y_MIN)/(Y_MAX-Y_MIN)*(H-PAD_T-PAD_B);

// ── grid + axes ──────────────────────────────────────────
const gridG=document.getElementById('qgrid');
for (let xv=2; xv<=10; xv+=2){
  const x=sx(xv);
  const l=document.createElementNS('http://www.w3.org/2000/svg','line');
  l.setAttribute('x1',x);l.setAttribute('x2',x);
  l.setAttribute('y1',20);l.setAttribute('y2',280);
  l.setAttribute('stroke','#16161b');l.setAttribute('stroke-width','1');
  gridG.appendChild(l);
}
for (let yv=0; yv<=8; yv+=2){
  const y=sy(yv);
  const l=document.createElementNS('http://www.w3.org/2000/svg','line');
  l.setAttribute('x1',48);l.setAttribute('x2',500);
  l.setAttribute('y1',y);l.setAttribute('y2',y);
  l.setAttribute('stroke','#16161b');l.setAttribute('stroke-width','1');
  gridG.appendChild(l);
}

// ── data dots ────────────────────────────────────────────
const ptsG=document.getElementById('qpoints');
const ptCircles = POINTS.map((p,i)=>{
  const c=document.createElementNS('http://www.w3.org/2000/svg','circle');
  c.setAttribute('cx',sx(p.x));c.setAttribute('cy',sy(p.y));c.setAttribute('r',5);
  c.dataset.idx=String(i);
  ptsG.appendChild(c);
  return c;
});

const linesG=document.getElementById('qlines');
const resG=document.getElementById('qresiduals');
const markerG=document.getElementById('qmarker');
const readout=document.getElementById('qReadout');
const ctrl=document.getElementById('ctrlCard');
const promptText=document.getElementById('promptText');
const fb=document.getElementById('qFeedback');
const qIdx=document.getElementById('qIdx');
const qIdxFoot=document.getElementById('qIdxFoot');
const qKind=document.getElementById('qKind');
const dots=document.querySelectorAll('.dots .dot');
const btnPrev=document.getElementById('qPrev');
const btnNext=document.getElementById('qNext');
const stage=document.getElementById('qzStage');
const footer=document.getElementById('qFooter');
const results=document.getElementById('resultsScreen');

function clearStage(){
  linesG.innerHTML=''; resG.innerHTML=''; markerG.innerHTML='';
  ctrl.innerHTML=''; readout.innerHTML='';
  fb.classList.add('hidden'); fb.className='qz-feedback hidden';
  ptCircles.forEach(c=>{c.classList.remove('picked','correct','wrong','clickable');c.setAttribute('r','5');});
}

function setFeedback(ok, msg){
  fb.classList.remove('hidden');
  fb.className='qz-feedback ' + (ok ? 'ok' : 'bad');
  fb.innerHTML = msg;
}

function makeLine(m,b,cls){
  const x0=X_MIN+0.2, x1=X_MAX-0.2;
  const y0=m*x0+b, y1=m*x1+b;
  const ln=document.createElementNS('http://www.w3.org/2000/svg','line');
  ln.setAttribute('x1',sx(x0));ln.setAttribute('y1',sy(y0));
  ln.setAttribute('x2',sx(x1));ln.setAttribute('y2',sy(y1));
  ln.setAttribute('class','qline '+(cls||''));
  ln.setAttribute('stroke-linecap','round');
  return ln;
}

const sse = (m,b) => POINTS.reduce((s,p)=>{const r=p.y-(m*p.x+b);return s+r*r;},0);

const state = {
  q: 0,
  answers: [null,null,null,null], // boolean per question
  picks: [null,null,null,null],   // user pick metadata for recap
};
const QKINDS = ['Click the line', 'Click the point', 'Pick the prediction', 'Tune the line'];

// ────────────────────────────────────────────────────────
// Q1 — Which line fits best?
// ────────────────────────────────────────────────────────
function loadQ1(){
  qKind.textContent = QKINDS[0];
  promptText.textContent = "Three candidate lines run through the same scatter. Click the one that fits the data best.";
  const candidates = [
    { id:'A', m:1.30, b:-1.6, label:'A · steep' },
    { id:'B', m:0.81, b:0.59, label:'B · just right' },
    { id:'C', m:0.45, b:1.8,  label:'C · gentle' },
  ];
  const rendered = candidates.map(c=>{
    const ln=makeLine(c.m,c.b,'pick');
    ln.dataset.id=c.id;
    linesG.appendChild(ln);
    return ln;
  });
  const opts=document.createElement('div');
  opts.className='qz-options';
  opts.innerHTML = '<h3>Pick a line</h3>' + candidates.map((c,i)=>{
    const stroke = i===0 ? '#3f3f46' : (i===1 ? '#a78bfa' : '#3f3f46');
    return '<button class="qz-option" data-id="'+c.id+'"><span class="qz-swatch" style="background:'+stroke+'"></span><span>'+c.label+'</span></button>';
  }).join('');
  ctrl.appendChild(opts);
  const help=document.createElement('p');
  help.className='help';
  help.innerHTML="Tip: a good line should leave roughly equal numbers of dots above and below, with no obvious tilt.";
  ctrl.appendChild(help);

  let pickId=null;
  const optBtns = opts.querySelectorAll('.qz-option');
  function setPick(id){
    pickId=id;
    optBtns.forEach(b=>b.classList.toggle('picked', b.dataset.id===id));
    rendered.forEach(ln=>ln.classList.toggle('picked', ln.dataset.id===id));
    btnNext.disabled=false;
  }
  optBtns.forEach(b=>b.addEventListener('click',()=>setPick(b.dataset.id)));
  rendered.forEach(ln=>{
    ln.addEventListener('mouseenter',()=>ln.classList.add('hover'));
    ln.addEventListener('mouseleave',()=>ln.classList.remove('hover'));
    ln.addEventListener('click',()=>setPick(ln.dataset.id));
  });
  btnNext.disabled=true;
  btnNext.dataset.action='check';
  btnNext.textContent='Check';
  btnNext.onclick=()=>{
    if (!pickId) return;
    const ok = pickId==='B';
    state.answers[0]=ok; state.picks[0]=pickId;
    optBtns.forEach(b=>{
      b.classList.add('disabled');
      if (b.dataset.id==='B') b.classList.add('correct');
      if (b.dataset.id===pickId && !ok) b.classList.add('wrong');
    });
    rendered.forEach(ln=>{
      ln.classList.remove('hover');
      if (ln.dataset.id==='B') ln.classList.add('correct');
      else if (ln.dataset.id===pickId && !ok) ln.classList.add('wrong');
      else ln.classList.add('wrong');
    });
    setFeedback(ok,
      ok ? "<b>Right.</b> B has the smallest gaps overall — it doesn't overshoot or undershoot the trend."
         : "<b>Not quite.</b> Look at where the line ends: A flies above the top dots, C falls below them. B threads the middle.");
    btnNext.textContent='Next';
    btnNext.dataset.action='advance';
    btnNext.onclick=()=>advance();
  };
}

// ────────────────────────────────────────────────────────
// Q2 — Click the point with the largest residual
// ────────────────────────────────────────────────────────
function loadQ2(){
  qKind.textContent = QKINDS[1];
  promptText.textContent = "Each dashed line is the residual — how far the dot is from the best-fit line. Click the dot with the LARGEST residual.";
  // draw the best-fit line + residuals
  linesG.appendChild(makeLine(TRUE.m, TRUE.b, 'correct'));
  POINTS.forEach((p,i)=>{
    const pred = TRUE.m*p.x + TRUE.b;
    const ln=document.createElementNS('http://www.w3.org/2000/svg','line');
    ln.setAttribute('x1',sx(p.x));ln.setAttribute('x2',sx(p.x));
    ln.setAttribute('y1',sy(p.y));ln.setAttribute('y2',sy(pred));
    ln.dataset.idx=String(i);
    resG.appendChild(ln);
  });
  // make dots clickable + residual highlight on hover
  ptCircles.forEach((c,i)=>{
    c.classList.add('clickable');
    c.onmouseenter=()=>resG.querySelectorAll('line').forEach(l=>l.classList.toggle('qhilite', l.dataset.idx===String(i)));
    c.onmouseleave=()=>resG.querySelectorAll('line').forEach(l=>l.classList.remove('qhilite'));
  });
  // find the actual largest-residual index
  const residuals = POINTS.map(p => Math.abs(p.y - (TRUE.m*p.x + TRUE.b)));
  const correctIdx = residuals.indexOf(Math.max(...residuals));

  const help=document.createElement('div');
  help.innerHTML='<h3>Find the worst fit</h3><p class="help">The residual is just the vertical gap between the dot and the line. The point with the longest dashed line is the one the model misses most.</p>';
  ctrl.appendChild(help);

  let picked=null;
  function setPicked(i){
    picked=i;
    ptCircles.forEach((c,j)=>c.classList.toggle('picked', i===j));
    btnNext.disabled=false;
  }
  ptCircles.forEach((c,i)=>{ c.onclick=()=>setPicked(i); });

  btnNext.disabled=true;
  btnNext.textContent='Check';
  btnNext.onclick=()=>{
    if (picked===null) return;
    const ok = picked === correctIdx;
    state.answers[1]=ok; state.picks[1]={pick:picked, correct:correctIdx};
    ptCircles.forEach((c,i)=>{c.onclick=null;c.onmouseenter=null;c.onmouseleave=null;c.classList.remove('clickable');});
    ptCircles[correctIdx].classList.add('correct');
    ptCircles[correctIdx].setAttribute('r','7');
    if (!ok) ptCircles[picked].classList.add('wrong');
    // pin the highlight on the correct residual
    resG.querySelectorAll('line').forEach(l=>l.classList.toggle('qhilite', l.dataset.idx===String(correctIdx)));
    const r = (POINTS[correctIdx].y - (TRUE.m*POINTS[correctIdx].x + TRUE.b)).toFixed(2);
    setFeedback(ok,
      ok ? '<b>Yes!</b> Point at x='+POINTS[correctIdx].x.toFixed(0)+' has the longest residual — about '+r+' units off the line.'
         : '<b>Close.</b> The biggest gap is at x='+POINTS[correctIdx].x.toFixed(0)+' (residual '+r+'). Look for the longest dashed line, not the highest dot.');
    btnNext.textContent='Next';
    btnNext.onclick=()=>advance();
  };
}

// ────────────────────────────────────────────────────────
// Q3 — Use the line to predict
// ────────────────────────────────────────────────────────
function loadQ3(){
  qKind.textContent = QKINDS[2];
  const x_query = 7.5;
  const y_true = TRUE.m*x_query + TRUE.b;
  promptText.textContent = "Using the best-fit line, predict y when x = "+x_query+". Pick the closest range.";
  linesG.appendChild(makeLine(TRUE.m, TRUE.b, 'correct'));
  // marker showing the query x
  const ml=document.createElementNS('http://www.w3.org/2000/svg','line');
  ml.setAttribute('x1',sx(x_query));ml.setAttribute('x2',sx(x_query));
  ml.setAttribute('y1',sy(Y_MIN));ml.setAttribute('y2',sy(Y_MAX));
  markerG.appendChild(ml);
  const lbl=document.createElementNS('http://www.w3.org/2000/svg','text');
  lbl.setAttribute('x',sx(x_query)+8);lbl.setAttribute('y',32);
  lbl.textContent='x = '+x_query;
  markerG.appendChild(lbl);

  const buckets = [
    { id:'a', label:'≈ 4.0', range:[3.6, 4.4] },
    { id:'b', label:'≈ 5.5', range:[5.1, 5.9] },
    { id:'c', label:'≈ 6.7', range:[6.3, 7.1] },
    { id:'d', label:'≈ 8.2', range:[7.8, 8.6] },
  ];
  const correct = buckets.find(B => y_true>=B.range[0] && y_true<=B.range[1])?.id || 'c';
  const opts=document.createElement('div');
  opts.className='qz-options';
  opts.innerHTML = '<h3>Predicted y is closest to…</h3>' + buckets.map(B =>
    '<button class="qz-option" data-id="'+B.id+'"><span class="qz-swatch" style="background:#22d3ee"></span><span>'+B.label+'</span></button>'
  ).join('');
  ctrl.appendChild(opts);
  const help=document.createElement('p');
  help.className='help';
  help.innerHTML="Tip: drag your eye up the dashed line until it hits the indigo line, then read off the y-value on the left axis.";
  ctrl.appendChild(help);

  let pickId=null;
  const optBtns=opts.querySelectorAll('.qz-option');
  optBtns.forEach(b=>b.onclick=()=>{
    pickId=b.dataset.id;
    optBtns.forEach(o=>o.classList.toggle('picked', o.dataset.id===pickId));
    btnNext.disabled=false;
  });

  btnNext.disabled=true;
  btnNext.textContent='Check';
  btnNext.onclick=()=>{
    if (!pickId) return;
    const ok = pickId === correct;
    state.answers[2]=ok; state.picks[2]={pick:pickId, correct};
    // draw the actual prediction crosshair
    const xpx=sx(x_query), ypx=sy(y_true);
    const v=document.createElementNS('http://www.w3.org/2000/svg','line');
    v.setAttribute('x1',xpx);v.setAttribute('x2',xpx);v.setAttribute('y1',sy(0));v.setAttribute('y2',ypx);
    markerG.appendChild(v);
    const h=document.createElementNS('http://www.w3.org/2000/svg','line');
    h.setAttribute('x1',sx(0));h.setAttribute('x2',xpx);h.setAttribute('y1',ypx);h.setAttribute('y2',ypx);
    markerG.appendChild(h);
    const dot=document.createElementNS('http://www.w3.org/2000/svg','circle');
    dot.setAttribute('cx',xpx);dot.setAttribute('cy',ypx);dot.setAttribute('r',6);
    markerG.appendChild(dot);
    optBtns.forEach(b=>{
      b.classList.add('disabled');b.onclick=null;
      if (b.dataset.id===correct) b.classList.add('correct');
      if (b.dataset.id===pickId && !ok) b.classList.add('wrong');
    });
    setFeedback(ok,
      ok ? '<b>Spot on.</b> The line passes through y = '+y_true.toFixed(2)+' at x = '+x_query+'.'
         : '<b>Off by a bit.</b> y = '+TRUE.m.toFixed(2)+'·'+x_query+' + '+TRUE.b.toFixed(2)+' = '+y_true.toFixed(2)+'.');
    btnNext.textContent='Next';
    btnNext.onclick=()=>advance();
  };
}

// ────────────────────────────────────────────────────────
// Q4 — Tune m, b to minimize SSE under a target
// ────────────────────────────────────────────────────────
function loadQ4(){
  qKind.textContent = QKINDS[3];
  promptText.textContent = "Drag the sliders for m (slope) and b (intercept) until the total squared error drops below the green marker. Then submit.";
  // start far from optimum so there's something to do
  let m = 0.4, b = 2.4;
  const optimalSSE = sse(TRUE.m, TRUE.b);
  const startSSE = sse(m, b);
  const targetSSE = optimalSSE * 1.4; // within 40% of best is "pass"
  const maxSSE = startSSE * 1.05;

  const liveLine = makeLine(m, b, 'picked');
  linesG.appendChild(liveLine);
  function redraw(){
    const x0=X_MIN+0.2, x1=X_MAX-0.2;
    liveLine.setAttribute('x1',sx(x0));liveLine.setAttribute('y1',sy(m*x0+b));
    liveLine.setAttribute('x2',sx(x1));liveLine.setAttribute('y2',sy(m*x1+b));
    // refresh residuals
    resG.innerHTML='';
    POINTS.forEach((p)=>{
      const pred=m*p.x+b;
      const ln=document.createElementNS('http://www.w3.org/2000/svg','line');
      ln.setAttribute('x1',sx(p.x));ln.setAttribute('x2',sx(p.x));
      ln.setAttribute('y1',sy(p.y));ln.setAttribute('y2',sy(pred));
      resG.appendChild(ln);
    });
    const cur = sse(m,b);
    const cls = cur <= targetSSE ? 'good' : (cur <= targetSSE*2 ? 'warn' : 'bad');
    readout.innerHTML =
      '<div class="pill"><span class="lbl">SSE</span><span class="val '+cls+'">'+cur.toFixed(2)+'</span></div>'+
      '<div class="pill"><span class="lbl">target</span><span class="val good">≤ '+targetSSE.toFixed(2)+'</span></div>';
    // bar
    const fillPct = Math.max(2, Math.min(100, (cur/maxSSE)*100));
    const tgtPct  = Math.max(2, Math.min(100, (targetSSE/maxSSE)*100));
    bar.querySelector('.fill').style.width = fillPct+'%';
    bar.querySelector('.target-marker').style.left = tgtPct+'%';
    btnNext.disabled = false; // submission allowed any time
  }

  const ui=document.createElement('div');
  ui.innerHTML =
    '<h3>Tune the line</h3>'+
    '<div class="qz-slider-row"><label>m</label><input id="qm" type="range" min="0" max="1.6" step="0.01" value="'+m+'"/><output id="qmOut">'+m.toFixed(2)+'</output></div>'+
    '<div class="qz-slider-row"><label>b</label><input id="qb" type="range" min="-2" max="3" step="0.01" value="'+b+'"/><output id="qbOut">'+b.toFixed(2)+'</output></div>'+
    '<div class="qz-sse-bar"><div class="lbl"><span>error</span><span class="target">target</span></div><div class="track"><div class="fill"></div><div class="target-marker"></div></div></div>'+
    '<p class="help">When the bar slides into the green zone, hit <code>Submit</code>.</p>';
  ctrl.appendChild(ui);
  const bar = ui.querySelector('.qz-sse-bar');
  const sM = ui.querySelector('#qm'), sB = ui.querySelector('#qb');
  const oM = ui.querySelector('#qmOut'), oB = ui.querySelector('#qbOut');
  sM.addEventListener('input',()=>{ m=parseFloat(sM.value); oM.textContent=m.toFixed(2); redraw(); });
  sB.addEventListener('input',()=>{ b=parseFloat(sB.value); oB.textContent=b.toFixed(2); redraw(); });
  redraw();

  btnNext.disabled=false;
  btnNext.textContent='Submit';
  btnNext.onclick=()=>{
    const cur = sse(m,b);
    const ok = cur <= targetSSE;
    state.answers[3]=ok; state.picks[3]={m,b,sse:cur};
    sM.disabled=true; sB.disabled=true;
    // snap to optimum to celebrate
    const targetM=TRUE.m, targetB=TRUE.b;
    const animStart=performance.now();
    function tick(t){
      const k=Math.min(1,(t-animStart)/700);
      const e=1-Math.pow(1-k,3);
      const cm = m + (targetM - m)*e;
      const cb = b + (targetB - b)*e;
      const x0=X_MIN+0.2, x1=X_MAX-0.2;
      liveLine.setAttribute('x1',sx(x0));liveLine.setAttribute('y1',sy(cm*x0+cb));
      liveLine.setAttribute('x2',sx(x1));liveLine.setAttribute('y2',sy(cm*x1+cb));
      liveLine.classList.add('correct');
      if (k<1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    setFeedback(ok,
      ok ? '<b>Optimum reached!</b> SSE landed at '+cur.toFixed(2)+', under the target of '+targetSSE.toFixed(2)+'.'
         : '<b>So close.</b> Your SSE was '+cur.toFixed(2)+'; the target was '+targetSSE.toFixed(2)+'. The animated line above is the true least-squares fit.');
    btnNext.textContent='See results';
    btnNext.onclick=()=>showResults();
  };
}

// ────────────────────────────────────────────────────────
// Driver
// ────────────────────────────────────────────────────────
const LOADERS = [loadQ1, loadQ2, loadQ3, loadQ4];

function loadQ(i){
  state.q = i;
  qIdx.textContent = String(i+1);
  qIdxFoot.textContent = String(i+1);
  dots.forEach((d,j)=>{
    d.classList.remove('active','done');
    if (j<i) d.classList.add('done');
    else if (j===i) d.classList.add('active');
  });
  btnPrev.disabled = i===0;
  clearStage();
  LOADERS[i]();
}

function advance(){
  if (state.q < LOADERS.length-1) loadQ(state.q+1);
  else showResults();
}

function showResults(){
  const score = state.answers.filter(Boolean).length;
  document.getElementById('scoreNum').textContent = String(score);
  const headlines = [
    'Worth a second pass.',
    'Solid start.',
    'Strong instincts.',
    'You\\'ve got the gist.',
    'Calibrated. Linear regression makes sense to you.',
  ];
  const labels = [
    'No worries — re-run the lesson video and try again.',
    'You can spot the right shape; the details are next.',
    'Three out of four — close to fluent.',
    'Just one slip. Re-do that one and you\\'re done.',
    'Clean run. Move on to residuals or polynomial fits next.',
  ];
  document.getElementById('scoreHeadline').textContent = headlines[score];
  document.getElementById('scoreLabel').textContent = labels[score];
  const recap = document.getElementById('qResults');
  recap.innerHTML = state.answers.map((ok,i)=>
    '<li class="'+(ok?'ok':'bad')+'"><span class="check">'+(ok?'✓':'✕')+'</span><span class="qkind">'+(i+1)+'. '+QKINDS[i]+'</span><span class="qresult">'+(ok?'correct':'missed')+'</span></li>'
  ).join('');
  stage.classList.add('hidden');
  footer.classList.add('hidden');
  results.classList.remove('hidden');
  document.getElementById('qRestart').onclick = ()=>{
    state.answers = [null,null,null,null];
    state.picks = [null,null,null,null];
    stage.classList.remove('hidden');
    footer.classList.remove('hidden');
    results.classList.add('hidden');
    loadQ(0);
  };
}

btnPrev.addEventListener('click',()=>{
  if (state.q>0) loadQ(state.q-1);
});

loadQ(0);
`;

// ─────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────
export interface CannedDemo {
  id: string;
  title: string;
  summary: string;
  match: (text: string) => boolean;
  content: FrameContent;
}

export const LINEAR_REGRESSION_DEMO: CannedDemo = {
  id: 'linear-regression',
  title: 'Linear Regression',
  summary: 'A guided four-step walkthrough: see the data, pick a line, measure the error, then let least-squares find the optimum.',
  match: (text) => /linear\s+regression/i.test(text),
  content: { html: LR_HTML, css: LR_CSS, js: LR_JS },
};

export const LOOK_AT_DATA_DEMO: CannedDemo = {
  id: 'look-at-data',
  title: 'Look at the data',
  summary: 'Before fitting any model: read a scatter plot. One row at a time, then trend, then spread.',
  // Loose matcher: any selection containing "data", "scatter", "observation",
  // or "point(s)" within the demo flow lands on this lesson. The demo branch
  // is a controlled environment, so loose matching is intentional.
  match: (text) => /\b(data|scatter|observations?|datapoints?)\b/i.test(text),
  content: { html: LAD_HTML, css: LAD_CSS, js: LAD_JS },
};

export const RESIDUALS_DEMO: CannedDemo = {
  id: 'residuals',
  title: 'Residuals',
  summary: 'Every gap between a point and the line is a residual. Square them, sum them — that is SSE.',
  match: (text) => /\bresiduals?\b/i.test(text),
  content: { html: RES_HTML, css: RES_CSS, js: RES_JS },
};

export const LINEAR_REGRESSION_QUIZ_DEMO: CannedDemo = {
  id: 'linear-regression-quiz',
  title: 'Linear Regression — Quick Check',
  summary: 'A four-question interactive quiz: pick the best line, click the worst-fitting dot, predict y, then tune the slope and intercept under a target SSE.',
  match: (text) => /\b(quiz|test\s+me|practice|check\s+understanding|quick\s+check|challenge)\b/i.test(text),
  content: { html: QUIZ_HTML, css: QUIZ_CSS, js: QUIZ_JS },
};

// Order matters — first match wins. The quiz matcher is the most specific
// (it short-circuits on "quiz"), then residuals (more specific than the
// generic data matcher), then look-at-data as a loose catch-all.
const DEMOS: CannedDemo[] = [
  LINEAR_REGRESSION_QUIZ_DEMO,
  LINEAR_REGRESSION_DEMO,
  RESIDUALS_DEMO,
  LOOK_AT_DATA_DEMO,
];

// ─────────────────────────────────────────────────────────────────
// Fallback for unmatched highlights — keeps the demo branch
// 100% offline. Renders a polished "no canned walkthrough yet"
// card that names the highlighted term and points back to the
// two registered topics. Never calls the API.
// ─────────────────────────────────────────────────────────────────
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));
}

const FALLBACK_CSS = SHARED_CSS + `
.fb-wrap{display:grid;gap:14px;}
.fb-card{padding:22px 24px;}
.fb-badge{display:inline-block;padding:4px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#c4b5fd;background:rgba(99,102,241,.12);border:1px solid rgba(129,140,248,.3);border-radius:999px;margin-bottom:14px;}
.fb-term{font-size:28px;letter-spacing:-0.01em;margin:0 0 6px;color:#e0e7ff;}
.fb-sub{margin:0 0 18px;color:#a1a1aa;font-size:13px;}
.fb-list{list-style:none;padding:0;margin:0;display:grid;gap:10px;}
.fb-list li{padding:14px 16px;border:1px solid #1f1f24;background:#0e0e12;border-radius:10px;}
.fb-list li b{color:#c4b5fd;display:block;margin-bottom:4px;font-size:14px;}
.fb-list li span{color:#a1a1aa;font-size:13px;line-height:1.5;}
.fb-foot{margin-top:14px;font-size:12px;color:#71717a;}
.fb-foot code{background:#15151b;color:#c4b5fd;padding:1px 6px;border-radius:5px;font-family:ui-monospace,monospace;font-size:11px;}
`;

function makeFallbackDemo(highlighted: string): CannedDemo {
  const trimmed = highlighted.trim();
  const display = trimmed.length > 80 ? trimmed.slice(0, 80) + '…' : trimmed;
  const title = trimmed.length > 40 ? trimmed.slice(0, 40) + '…' : trimmed || 'Concept';
  const html = `
<header class="lh">
  <p class="kicker">Demo branch · canned content</p>
  <h1>${escapeHtml(title)}</h1>
</header>

<div class="fb-wrap">
  <div class="fb-card card">
    <span class="fb-badge">No canned walkthrough yet</span>
    <h2 class="fb-term">&ldquo;${escapeHtml(display)}&rdquo;</h2>
    <p class="fb-sub">This branch runs entirely offline — the agent pipeline is disabled and only hand-built lessons are available. The two registered walkthroughs are below.</p>
    <ul class="fb-list">
      <li>
        <b>Linear Regression</b>
        <span>Four-step guided walkthrough: see the data, pick a line, measure error, let least-squares find the optimum. Sliders + animated fit.</span>
      </li>
      <li>
        <b>Look at the data</b>
        <span>Reading a scatter plot from scratch. Rows stream into a table while dots pop onto the chart; then trend, spread, and noise.</span>
      </li>
    </ul>
    <p class="fb-foot">Highlight either phrase from the parent lesson and click <code>Explain</code>.</p>
  </div>
</div>
`;
  return {
    id: 'fallback',
    title,
    summary: `Demo placeholder for "${display}".`,
    match: () => true,
    content: { html, css: FALLBACK_CSS, js: '' },
  };
}

// Lightweight content used by the seeded demo graph for nodes that
// don't have their own full walkthrough. Renders a clean topic card
// with the title, a short blurb, and a parent-topic kicker — same
// chrome as the real lessons so the canvas reads as one product.
const TOPIC_CARD_CSS = SHARED_CSS + `
.topic-card{padding:24px;color:#d4d4d8;line-height:1.6;}
.topic-card p{margin:0 0 18px;font-size:14px;}
.topic-card p:last-of-type{margin-bottom:0;}
.topic-card b{color:#c4b5fd;font-weight:600;}
.topic-card em{color:#fbbf24;font-style:normal;}
.topic-foot{margin-top:18px;padding-top:14px;border-top:1px solid #1f1f24;font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:.08em;}
`;

export function makeTopicCardContent(
  title: string,
  blurb: string,
  parentTopic: string,
): FrameContent {
  const html = `
<header class="lh">
  <p class="kicker">${escapeHtml(parentTopic)}</p>
  <h1>${escapeHtml(title)}</h1>
</header>
<div class="topic-card card">
  <p>${blurb}</p>
  <div class="topic-foot">Demo graph node · canned topic</div>
</div>
`;
  return { html, css: TOPIC_CARD_CSS, js: '' };
}

// Always returns a CannedDemo. On this branch we never call the API:
// if no specific demo matches, a fallback placeholder is returned so
// the user still sees a clean lesson card. The optional `question`
// argument is ignored on this branch (no chat-driven canned demos
// are registered yet).
export function findCannedDemo(text: string, _question?: string): CannedDemo {
  return DEMOS.find((d) => d.match(text)) ?? makeFallbackDemo(text);
}

// Mimic the streaming flow's UX: short staged delay so the loading
// state appears briefly, then the lesson resolves. Bypasses the API.
export async function runCannedDemo(frameId: string, demo: CannedDemo): Promise<void> {
  const { updateFrame } = useGraphStore.getState();
  updateFrame(frameId, {
    title: demo.title,
    summary: 'Building interactive walkthrough…',
    mode: 'visual_html',
  });
  await new Promise((r) => setTimeout(r, 450));
  updateFrame(frameId, {
    title: demo.title,
    summary: demo.summary,
    mode: 'visual_html',
    content: demo.content,
    loading: false,
  });
}
