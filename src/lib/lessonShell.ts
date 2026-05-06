import type { FrameContent } from '../types';

interface ShellOpts {
  rich?: boolean;
  bridge?: boolean;
}

// Sandbox lessons. allow-scripts is required (lessons run JS).
// We deliberately omit allow-same-origin so scripts get a unique opaque origin
// and cannot reach localStorage / cookies / IndexedDB on this app's origin.
export const LESSON_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';

const SELECTION_BRIDGE = `
(function(){
  function send(){
    var s = window.getSelection && window.getSelection();
    var t = s ? s.toString() : '';
    if (!t) { parent.postMessage({type:'frame-selection',text:''}, '*'); return; }
    var r = s.rangeCount ? s.getRangeAt(0).getBoundingClientRect() : null;
    parent.postMessage({type:'frame-selection',text:t,rect:{x:r?r.right:0,y:r?r.top:0}}, '*');
  }
  document.addEventListener('mouseup', function(){ setTimeout(send, 0); });
  window.addEventListener('error', function(e){
    parent.postMessage({type:'frame-runtime-error', message:String(e && e.message || e), source:e && e.filename, line:e && e.lineno, col:e && e.colno}, '*');
  });
  window.addEventListener('unhandledrejection', function(e){
    var r = e && e.reason;
    parent.postMessage({type:'frame-runtime-error', message:'Unhandled rejection: ' + (r && r.message || String(r))}, '*');
  });
})();
`;

const RICH_LIBS = `
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" crossorigin="anonymous"/>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js" crossorigin="anonymous"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js" crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js" crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/p5@1.10.0/lib/p5.min.js" crossorigin="anonymous"></script>
<script>
  window.addEventListener('load', function(){
    if (window.renderMathInElement) {
      try {
        window.renderMathInElement(document.body, {
          delimiters: [
            {left: '$$', right: '$$', display: true},
            {left: '\\\\(', right: '\\\\)', display: false},
            {left: '$', right: '$', display: false},
          ],
          throwOnError: false,
        });
      } catch (e) { /* ignore */ }
    }
  });
</script>
`;

const BASE_CSS = `
html,body{background:#0a0a0a;color:#e5e5e5;}
body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;padding:32px 24px;line-height:1.6;}
.lesson-root{max-width:720px;margin:0 auto;}
h1,h2,h3,h4{color:#f5f5f5;letter-spacing:-0.01em;}
h1{font-size:1.6rem;margin-top:0;}
h2{font-size:1.25rem;margin-top:1.8rem;}
a{color:#a5b4fc;}
button{font:inherit;cursor:pointer;}
code,pre{font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;}
pre{background:#111114;border:1px solid #1f1f24;border-radius:10px;padding:14px;overflow:auto;}
:not(pre)>code{background:#15151b;padding:2px 6px;border-radius:6px;font-size:0.92em;color:#d4d4d8;}
.btn-primary{background:#6366f1;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-weight:500;transition:background .15s;}
.btn-primary:hover{background:#818cf8;}
.btn-ghost{background:#15151b;color:#e5e5e5;border:1px solid #2a2a30;border-radius:8px;padding:8px 14px;transition:border-color .15s;}
.btn-ghost:hover{border-color:#3a3a42;}
.card{background:#0e0e12;border:1px solid #1f1f24;border-radius:12px;padding:18px;}
::selection{background:rgba(99,102,241,0.35);color:#fff;}
*{box-sizing:border-box;}
svg text{fill:#d4d4d8;}
`;

const PREVIEW_CSS = `
html,body{background:#0a0a0d;color:#e5e5e5;}
body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;padding:14px;line-height:1.55;}
h1,h2,h3{color:#f5f5f5;}
*{box-sizing:border-box;}
`;

export function buildLessonHtml(content: FrameContent, opts: ShellOpts = {}): string {
  const rich = opts.rich !== false;
  const bridge = opts.bridge !== false;
  const css = rich ? BASE_CSS : PREVIEW_CSS;
  const libs = rich ? RICH_LIBS : '';
  const bridgeScript = bridge ? `<script>${SELECTION_BRIDGE}</script>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>${libs}<style>${css}${content.css ?? ''}</style></head><body><div class="lesson-root">${content.html ?? ''}</div><script>${content.js ?? ''}<\/script>${bridgeScript}</body></html>`;
}
