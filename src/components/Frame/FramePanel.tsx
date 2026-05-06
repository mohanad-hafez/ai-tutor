import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { useDocumentStore } from '../../store/documentStore';
import { quiz as quizApi } from '../../agent/tutor';
import { startLesson, startPrereqLesson, startVideoDirect } from '../../lib/lessonFlow';
import type { FrameContent } from '../../types';
import { buildLessonHtml, LESSON_SANDBOX } from '../../lib/lessonShell';
import { AgentTracePanel } from './AgentTracePanel';
import { VideoFramePlayer } from './VideoFramePlayer';

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

  const [runtimeErr, setRuntimeErr] = useState<string | null>(null);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'frame-runtime-error') {
        setRuntimeErr(String(e.data.message || 'Unknown error'));
        return;
      }
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
    setRuntimeErr(null);
    setViewOverride(null);
  }, [focusedId]);

  if (!node) return null;
  const data = node.data;

  const askFromInline = (question: string) => {
    if (!inline) return;
    startLesson({
      sourceText: inline.text,
      question,
      docSummary,
      parentId: node.id,
      parentTitle: data.title,
    });
    setInline(null);
    setAskQuestion('');
  };

  const animateFromInline = (question: string) => {
    if (!inline) return;
    startVideoDirect({
      sourceText: inline.text,
      question,
      docSummary,
      parentId: node.id,
      parentTitle: data.title,
    });
    setInline(null);
    setAskQuestion('');
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
      if (res.mode !== 'video_manim') {
        updateFrame(id, {
          title: res.title,
          summary: res.summary,
          content: res.content,
          loading: false,
        });
      }
    } catch (err) {
      updateFrame(id, {
        summary: 'Error: ' + (err as Error).message,
        loading: false,
      });
    }
  };

  const animateThis = () => {
    if (!data.sourceText) return;
    startVideoDirect({
      sourceText: data.sourceText,
      question: data.summary,
      docSummary,
      parentId: node.id,
      parentTitle: data.title,
    });
  };

  const isVideo = data.type === 'video' || !!data.content?.videoUrl || !!data.videoJobId;
  const showLoadingMain = data.loading && !isVideo;
  const trace = data.trace || [];
  const hasTrace = trace.length > 0;
  // Default to 'trace' view while loading so the live pipeline is visible during the demo.
  // Manual override sticks until the frame is unfocused.
  const [viewOverride, setViewOverride] = useState<'lesson' | 'trace' | null>(null);
  const showTrace = viewOverride
    ? viewOverride === 'trace'
    : data.loading && hasTrace;

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
        {hasTrace && (
          <div className="flex items-center gap-0.5 rounded-md border border-neutral-800 bg-[#0d0d11] p-0.5">
            <button
              onClick={() => setViewOverride('lesson')}
              className={`rounded px-2.5 py-1 text-[11px] font-medium transition ${
                !showTrace ? 'bg-indigo-500/15 text-indigo-200' : 'text-neutral-400 hover:text-neutral-100'
              }`}
              title="Show the lesson"
            >
              Lesson
            </button>
            <button
              onClick={() => setViewOverride('trace')}
              className={`flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium transition ${
                showTrace ? 'bg-indigo-500/15 text-indigo-200' : 'text-neutral-400 hover:text-neutral-100'
              }`}
              title="Show the agent pipeline"
            >
              <span className="font-mono text-[9px] uppercase tracking-[0.12em] opacity-70">{trace.length}</span>
              Pipeline
            </button>
          </div>
        )}
        {data.sourceText && data.type !== 'video' && (
          <button
            onClick={animateThis}
            className="flex items-center gap-1.5 rounded-md border border-neutral-800 bg-[#0d0d11] px-3 py-1.5 text-[11px] font-medium text-neutral-300 transition hover:border-indigo-500/40 hover:text-indigo-300"
            title="Animate this concept"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="6 4 20 12 6 20 6 4"/>
            </svg>
            Animate
          </button>
        )}
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

      {data.prerequisites && data.prerequisites.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800/80 bg-[#0c0c10] px-4 py-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-neutral-500">
            Assumes
          </span>
          {data.prerequisites.map((p, i) => (
            <button
              key={i}
              onClick={() =>
                startPrereqLesson({
                  childFrameId: node.id,
                  prereqTitle: p.title,
                  prereqBrief: p.brief,
                  docSummary,
                })
              }
              title={p.brief}
              className="group flex items-center gap-1 rounded-md border border-neutral-800 bg-[#0d0d11] px-2 py-1 text-[11px] text-neutral-300 transition hover:border-indigo-500/50 hover:text-indigo-300"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
              {p.title}
            </button>
          ))}
        </div>
      )}

      <div className="relative flex-1 overflow-hidden bg-[#0a0a0d]">
        {showTrace ? (
          <AgentTracePanel trace={trace} loading={!!data.loading} />
        ) : isVideo ? (
          <VideoFramePlayer data={data} />
        ) : data.content?.html ? (
          <>
            <iframe
              title={data.title}
              srcDoc={buildLessonHtml(data.content)}
              sandbox={LESSON_SANDBOX}
              className="h-full w-full border-0"
            />
            {data.loading && (
              <div className="absolute right-3 top-3 z-30 flex items-center gap-2 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-indigo-300 backdrop-blur-md">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
                streaming
              </div>
            )}
            {runtimeErr && (
              <div className="absolute left-1/2 top-3 z-30 flex max-w-[480px] -translate-x-1/2 items-center gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200 backdrop-blur-md">
                <span className="font-mono uppercase tracking-[0.12em] text-rose-300">script error</span>
                <span className="line-clamp-1 flex-1">{runtimeErr}</span>
                <button
                  onClick={() => {
                    if (!data.sourceText) return;
                    setRuntimeErr(null);
                    updateFrame(node.id, { loading: true, summary: 'Retrying…' });
                    startLesson({
                      sourceText: data.sourceText,
                      docSummary,
                      parentId: parents[0],
                    });
                  }}
                  className="rounded border border-rose-500/40 px-2 py-0.5 text-[10px] font-medium text-rose-100 hover:bg-rose-500/20"
                >
                  Retry
                </button>
                <button onClick={() => setRuntimeErr(null)} className="text-rose-300/70 hover:text-rose-200" title="Dismiss">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
                </button>
              </div>
            )}
          </>
        ) : data.summary?.startsWith('Error:') ? (
          <div className="flex h-full items-center justify-center p-8">
            <div className="max-w-md rounded-lg border border-rose-500/30 bg-rose-500/5 p-6 text-center">
              <div className="mb-2 text-sm font-semibold text-rose-300">Generation failed</div>
              <div className="mb-4 text-xs leading-relaxed text-rose-300/80">
                {data.summary.replace(/^Error:\s*/, '')}
              </div>
              {data.sourceText && (
                <button
                  onClick={() => {
                    if (!data.sourceText) return;
                    updateFrame(node.id, { loading: true, summary: 'Retrying…' });
                    startLesson({
                      sourceText: data.sourceText,
                      docSummary,
                      parentId: parents[0],
                    });
                  }}
                  className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 transition hover:bg-rose-500/20"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        ) : showLoadingMain ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-neutral-400">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-800 border-t-indigo-500" />
              <div className="text-sm">{data.title || 'Generating interactive lesson…'}</div>
              {data.summary && data.summary !== 'Generating lesson…' && (
                <div className="max-w-md text-center text-xs text-neutral-500">
                  {data.summary}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-8 text-neutral-300">{data.summary}</div>
        )}

        {inline && !data.loading && (
          <div
            style={{ left: inline.x, top: inline.y }}
            className="absolute z-40 -translate-y-full"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="w-[420px] overflow-hidden rounded-xl border border-neutral-800 bg-[#0d0d11]/95 shadow-[0_20px_50px_-10px_rgba(0,0,0,0.8)] ring-1 ring-white/5 backdrop-blur-xl">
              <div className="border-b border-neutral-800/80 px-3 py-2">
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 h-3.5 w-0.5 shrink-0 rounded-full bg-indigo-500" />
                  <div className="line-clamp-2 text-[11px] leading-relaxed text-neutral-400">
                    {inline.text.slice(0, 160)}{inline.text.length > 160 ? '…' : ''}
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2 p-2">
                <textarea
                  autoFocus
                  value={askQuestion}
                  onChange={(e) => setAskQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      animateFromInline(askQuestion.trim());
                      return;
                    }
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
                  className="resize-none rounded-md border border-neutral-800 bg-[#15151b] px-2.5 py-2 text-[13px] text-neutral-100 placeholder:text-neutral-500 outline-none transition focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/20"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => askFromInline(askQuestion.trim())}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-[12px] font-medium text-white shadow-[0_4px_14px_-4px_rgba(99,102,241,0.6)] transition hover:bg-indigo-500"
                  >
                    {askQuestion.trim() ? 'Ask' : 'Explain'}
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14M13 5l7 7-7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => animateFromInline(askQuestion.trim())}
                    className="flex items-center gap-1.5 rounded-md border border-neutral-800 bg-[#15151b] px-3 py-2 text-[12px] font-medium text-neutral-200 transition hover:border-indigo-500/50 hover:text-indigo-300"
                    title="Animate this"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="6 4 20 12 6 20 6 4"/>
                    </svg>
                    Animate
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// retain export for compat with any other importers
export function _buildSrcDoc(c: FrameContent) {
  return buildLessonHtml(c);
}
