import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { useDocumentStore } from '../../store/documentStore';
import { explain, quiz as quizApi } from '../../agent/tutor';
import type { FrameContent } from '../../types';

interface InlineSel {
  text: string;
  x: number;
  y: number;
}

export function FramePanel() {
  const focusedId = useGraphStore((s) => s.focusedNodeId);
  const setFocused = useGraphStore((s) => s.setFocused);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const addFrame = useGraphStore((s) => s.addFrame);
  const updateFrame = useGraphStore((s) => s.updateFrame);
  const docSummary = useDocumentStore((s) => s.summary);

  const node = nodes.find((n) => n.id === focusedId);
  const [inline, setInline] = useState<InlineSel | null>(null);
  const [askQuestion, setAskQuestion] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const parents = useMemo(
    () => edges.filter((e) => e.target === focusedId).map((e) => e.source),
    [edges, focusedId]
  );
  const children = useMemo(
    () => edges.filter((e) => e.source === focusedId).map((e) => e.target),
    [edges, focusedId]
  );

  useEffect(() => {
    if (!focusedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (inline) {
          setInline(null);
          setAskQuestion('');
        } else {
          setFocused(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusedId, setFocused, inline]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type !== 'frame-selection') return;
      const text = String(e.data.text || '').trim();
      if (!text) {
        setInline(null);
        return;
      }
      const rect = e.data.rect || { x: 40, y: 40 };
      const iframe = containerRef.current?.querySelector('iframe');
      const ifRect = iframe?.getBoundingClientRect();
      const baseRect = containerRef.current?.getBoundingClientRect();
      if (!ifRect || !baseRect) return;
      setInline({
        text,
        x: ifRect.left - baseRect.left + rect.x,
        y: ifRect.top - baseRect.top + rect.y,
      });
      setAskQuestion('');
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  useEffect(() => {
    setInline(null);
    setAskQuestion('');
  }, [focusedId]);

  if (!node) return null;
  const data = node.data;

  const askFromInline = async (question: string) => {
    if (!inline) return;
    const sel = inline.text;
    const id = crypto.randomUUID();
    addFrame(
      {
        id,
        type: 'child',
        title: sel.slice(0, 40) + (sel.length > 40 ? '…' : ''),
        summary: question || 'Generating lesson…',
        sourceText: sel,
        parentIds: [node.id],
        childIds: [],
        loading: true,
      },
      node.id
    );
    setInline(null);
    setAskQuestion('');
    setFocused(id);
    try {
      const res = await explain({
        text: sel,
        question,
        parentTitle: data.title,
        docSummary: docSummary || undefined,
      });
      updateFrame(id, {
        title: res.title,
        summary: res.summary,
        content: res.content,
        loading: false,
      });
    } catch (err) {
      updateFrame(id, {
        summary: 'Error: ' + (err as Error).message,
        loading: false,
      });
    }
  };

  const generateQuiz = async () => {
    const id = crypto.randomUUID();
    addFrame(
      {
        id,
        type: 'quiz',
        title: `Quiz: ${data.title}`,
        summary: 'Generating quiz…',
        parentIds: [node.id],
        childIds: [],
        loading: true,
      },
      node.id
    );
    setFocused(id);
    try {
      const res = await quizApi({
        title: data.title,
        summary: data.summary,
        sourceText: data.sourceText,
        docSummary: docSummary || undefined,
      });
      updateFrame(id, {
        title: res.title,
        summary: res.summary,
        content: res.content,
        loading: false,
      });
    } catch (err) {
      updateFrame(id, {
        summary: 'Error: ' + (err as Error).message,
        loading: false,
      });
    }
  };

  return (
    <div ref={containerRef} className="absolute inset-0 z-30 flex flex-col bg-[#07070a]">
      <div className="flex items-center gap-2 border-b border-neutral-800/80 bg-[#0a0a0d] px-3 py-2.5">
        <button
          onClick={() => setFocused(null)}
          className="rounded-md p-1.5 text-neutral-400 transition hover:bg-[#15151b] hover:text-neutral-100"
          title="Back to canvas (Esc)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <div className="mr-2 flex items-center gap-0.5 rounded-md border border-neutral-800 bg-[#0d0d11] p-0.5">
          <button
            onClick={() => parents[0] && setFocused(parents[0])}
            disabled={!parents.length}
            title="Parent lesson"
            className="rounded p-1 text-neutral-400 transition hover:bg-[#15151b] hover:text-neutral-100 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <button
            onClick={() => children[0] && setFocused(children[0])}
            disabled={!children.length}
            title="Child lesson"
            className="rounded p-1 text-neutral-400 transition hover:bg-[#15151b] hover:text-neutral-100 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
        <div className="flex-1 truncate">
          <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-neutral-500">
            {data.type}
          </div>
          <div className="truncate text-[13px] font-semibold tracking-tight text-neutral-100">
            {data.title}
          </div>
        </div>
        <button
          onClick={generateQuiz}
          className="flex items-center gap-1.5 rounded-md border border-neutral-800 bg-[#0d0d11] px-3 py-1.5 text-[11px] font-medium text-neutral-300 transition hover:border-amber-500/40 hover:text-amber-300"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>
          </svg>
          Quiz me
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden bg-[#0a0a0d]">
        {data.loading ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-neutral-400">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-800 border-t-indigo-500" />
              <div className="text-sm">Generating interactive lesson…</div>
              {data.summary && data.summary !== 'Generating lesson…' && (
                <div className="max-w-md text-center text-xs text-neutral-500">
                  {data.summary}
                </div>
              )}
            </div>
          </div>
        ) : data.content?.html ? (
          <iframe
            title={data.title}
            srcDoc={buildSrcDoc(data.content)}
            className="h-full w-full border-0"
          />
        ) : (
          <div className="p-8 text-neutral-300">{data.summary}</div>
        )}

        {inline && !data.loading && (
          <div
            style={{ left: inline.x, top: inline.y }}
            className="absolute z-40 -translate-y-full"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="w-[380px] overflow-hidden rounded-xl border border-neutral-800 bg-[#0d0d11]/95 shadow-[0_20px_50px_-10px_rgba(0,0,0,0.8)] ring-1 ring-white/5 backdrop-blur-xl">
              <div className="border-b border-neutral-800/80 px-3 py-2">
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 h-3.5 w-0.5 shrink-0 rounded-full bg-indigo-500" />
                  <div className="line-clamp-2 text-[11px] leading-relaxed text-neutral-400">
                    {inline.text.slice(0, 160)}{inline.text.length > 160 ? '…' : ''}
                  </div>
                </div>
              </div>
              <div className="flex items-end gap-2 p-2">
                <textarea
                  autoFocus
                  value={askQuestion}
                  onChange={(e) => setAskQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      askFromInline(askQuestion.trim());
                    }
                    if (e.key === 'Escape') {
                      setInline(null);
                      setAskQuestion('');
                    }
                  }}
                  rows={1}
                  placeholder="Ask anything, or press Enter to explain"
                  className="flex-1 resize-none rounded-md border border-neutral-800 bg-[#15151b] px-2.5 py-2 text-[13px] text-neutral-100 placeholder:text-neutral-500 outline-none transition focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/20"
                />
                <button
                  onClick={() => askFromInline(askQuestion.trim())}
                  className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-[12px] font-medium text-white shadow-[0_4px_14px_-4px_rgba(99,102,241,0.6)] transition hover:bg-indigo-500"
                >
                  {askQuestion.trim() ? 'Ask' : 'Explain'}
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M13 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function buildSrcDoc(c: FrameContent) {
  const bridge = `
    (function(){
      function send(){
        var s = window.getSelection && window.getSelection();
        var t = s ? s.toString() : '';
        if (!t) { parent.postMessage({type:'frame-selection',text:''}, '*'); return; }
        var r = s.rangeCount ? s.getRangeAt(0).getBoundingClientRect() : null;
        parent.postMessage({type:'frame-selection',text:t,rect:{x:r?r.right:0,y:r?r.top:0}}, '*');
      }
      document.addEventListener('mouseup', function(){ setTimeout(send, 0); });
    })();
  `;
  const baseCss = `
    html,body{background:#0a0a0a;color:#e5e5e5;}
    body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:32px 24px;line-height:1.6;}
    h1,h2,h3,h4{color:#f5f5f5;letter-spacing:-0.01em;}
    a{color:#a5b4fc;}
    ::selection{background:rgba(99,102,241,0.35);color:#fff;}
    *{box-sizing:border-box;}
  `;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/><style>${baseCss}${c.css ?? ''}</style></head><body>${c.html ?? ''}<script>${c.js ?? ''}<\/script><script>${bridge}<\/script></body></html>`;
}
