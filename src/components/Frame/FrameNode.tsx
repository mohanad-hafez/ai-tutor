import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, useStore, type NodeProps } from 'reactflow';
import type { FrameData } from '../../types';
import { useGraphStore } from '../../store/graphStore';
import { useDocumentStore } from '../../store/documentStore';
import { startLesson, startVideoDirect } from '../../lib/lessonFlow';
import { buildLessonHtml, LESSON_SANDBOX } from '../../lib/lessonShell';

const typeBadge: Record<FrameData['type'], { label: string; cls: string; bar: string }> = {
  root:        { label: 'Lesson',      cls: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20',  bar: 'bg-indigo-500' },
  child:       { label: 'Sublesson',   cls: 'bg-sky-500/10 text-sky-300 border-sky-500/20',           bar: 'bg-sky-500' },
  quiz:        { label: 'Quiz',        cls: 'bg-amber-500/10 text-amber-300 border-amber-500/20',     bar: 'bg-amber-500' },
  remediation: { label: 'Review',      cls: 'bg-rose-500/10 text-rose-300 border-rose-500/20',        bar: 'bg-rose-500' },
  summary:     { label: 'Summary',     cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20', bar: 'bg-emerald-500' },
  video:       { label: 'Animation',   cls: 'bg-violet-500/10 text-violet-300 border-violet-500/20',  bar: 'bg-violet-500' },
};

const zoomSelector = (s: { transform: number[] }) => s.transform[2];

const PREVIEW_SCALE = 0.42;

interface InlineSel {
  text: string;
  vx: number;
  vy: number;
}

export function FrameNode({ data, id }: NodeProps<FrameData>) {
  const setFocused = useGraphStore((s) => s.setFocused);
  const focusedId = useGraphStore((s) => s.focusedNodeId);
  const docSummary = useDocumentStore((s) => s.summary);
  const zoom = useStore(zoomSelector);
  const isFocused = focusedId === id;
  const showPreview = zoom >= 0.35;
  const badge = typeBadge[data.type];
  const isVideo = data.type === 'video' || !!data.content?.videoUrl;
  const videoStage = data.videoStage;
  const videoReady = !!data.content?.videoUrl;

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [inline, setInline] = useState<InlineSel | null>(null);
  const [askQ, setAskQ] = useState('');

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      if (e.data?.type !== 'frame-selection') return;
      const text = String(e.data.text || '').trim();
      if (!text) {
        setInline(null);
        return;
      }
      const r = e.data.rect || { x: 40, y: 40 };
      const ifr = iframeRef.current.getBoundingClientRect();
      // The iframe BCR already reflects the canvas (RF) zoom and the
      // 0.42 internal scale combined. The iframe-internal selection rect
      // is in 1x coords, so map it through both factors to get the
      // viewport offset of the selection.
      setInline({
        text,
        vx: ifr.left + r.x * PREVIEW_SCALE * zoom,
        vy: ifr.top + r.y * PREVIEW_SCALE * zoom,
      });
      setAskQ('');
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [zoom]);

  useEffect(() => {
    if (!inline) return;
    const onDoc = (e: MouseEvent) => {
      if (popoverRef.current?.contains(e.target as Node)) return;
      setInline(null);
      setAskQ('');
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setInline(null);
        setAskQ('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [inline]);

  const askFromInline = (question: string) => {
    if (!inline) return;
    startLesson({
      sourceText: inline.text,
      question,
      docSummary,
      parentId: id,
      parentTitle: data.title,
      noFocus: true,
    });
    setInline(null);
    setAskQ('');
  };

  const animateFromInline = (question: string) => {
    if (!inline) return;
    startVideoDirect({
      sourceText: inline.text,
      question,
      docSummary,
      parentId: id,
      parentTitle: data.title,
      noFocus: true,
    });
    setInline(null);
    setAskQ('');
  };

  return (
    <>
    <div
      onClick={() => setFocused(id)}
      className={`group relative w-[320px] overflow-hidden rounded-xl border bg-[#0e0e12] transition-all ${
        isFocused
          ? 'border-indigo-500/60 shadow-[0_0_0_1px_rgba(99,102,241,0.3),0_20px_40px_-10px_rgba(99,102,241,0.25)]'
          : 'border-neutral-800/80 shadow-[0_4px_20px_-8px_rgba(0,0,0,0.7)] hover:border-neutral-700 hover:shadow-[0_8px_30px_-8px_rgba(0,0,0,0.9)]'
      }`}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-2 !border-[#0e0e12] !bg-neutral-600" />

      <div className={`absolute left-0 top-0 h-full w-[3px] ${badge.bar}`} />

      <div className="px-4 pl-5 pt-3.5">
        <div className="mb-2 flex items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] ${badge.cls}`}>
            {badge.label}
          </span>
          {data.loading && (
            <span className="inline-flex items-center gap-1 text-[10px] text-neutral-500">
              <span className="h-1 w-1 animate-pulse rounded-full bg-indigo-400" />
              {isVideo && videoStage ? videoStage : 'generating'}
            </span>
          )}
        </div>
        <div className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight text-neutral-100">
          {data.title}
        </div>
        <div className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-neutral-400">
          {data.summary}
        </div>
      </div>

      {showPreview && (
        <div className="mx-4 mb-4 mt-3 overflow-hidden rounded-lg border border-neutral-800 bg-[#0a0a0d]">
          <div className="relative h-44 w-full">
            {isVideo ? (
              videoReady ? (
                <video
                  src={data.content!.videoUrl!}
                  muted
                  loop
                  autoPlay
                  playsInline
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-4">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-800 border-t-violet-500" />
                  <div className="text-[11px] text-neutral-400">{data.videoMessage || 'Rendering animation'}</div>
                  <div className="h-1 w-32 overflow-hidden rounded-full bg-neutral-800">
                    <div
                      className="h-full bg-violet-500 transition-all duration-500"
                      style={{ width: `${data.videoProgress ?? 0}%` }}
                    />
                  </div>
                </div>
              )
            ) : data.content?.html && !data.loading ? (
              <iframe
                ref={iframeRef}
                title={data.title}
                srcDoc={buildLessonHtml(data.content, { rich: false, bridge: true })}
                sandbox={LESSON_SANDBOX}
                className="border-0"
                style={{
                  transform: `scale(${PREVIEW_SCALE})`,
                  transformOrigin: 'top left',
                  width: `calc(100% / ${PREVIEW_SCALE})`,
                  height: `calc(176px / ${PREVIEW_SCALE})`,
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                {data.loading ? (
                  <div className="flex flex-col items-center gap-2 text-[11px] text-neutral-500">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-800 border-t-indigo-500" />
                    Building lesson
                  </div>
                ) : (
                  <span className="text-[11px] text-neutral-600">No preview</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-2 !border-[#0e0e12] !bg-neutral-600" />
    </div>
    {inline && createPortal(
      <div
        ref={popoverRef}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          left: inline.vx,
          top: inline.vy - 12,
          transform: 'translateY(-100%)',
          zIndex: 60,
        }}
      >
        <div className="w-[360px] overflow-hidden rounded-xl border border-neutral-800 bg-[#0d0d11]/95 shadow-[0_20px_50px_-10px_rgba(0,0,0,0.8)] ring-1 ring-white/5 backdrop-blur-xl">
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
              value={askQ}
              onChange={(e) => setAskQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  animateFromInline(askQ.trim());
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  askFromInline(askQ.trim());
                }
              }}
              rows={1}
              placeholder="Ask anything, or press Enter to explain"
              className="resize-none rounded-md border border-neutral-800 bg-[#15151b] px-2.5 py-2 text-[13px] text-neutral-100 placeholder:text-neutral-500 outline-none transition focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/20"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => askFromInline(askQ.trim())}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-[12px] font-medium text-white shadow-[0_4px_14px_-4px_rgba(99,102,241,0.6)] transition hover:bg-indigo-500"
                title={askQ.trim() ? 'Ask (Enter) — ⌘↵ to animate' : 'Explain (Enter) — ⌘↵ to animate'}
              >
                {askQ.trim() ? 'Ask' : 'Explain'}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </button>
              <button
                onClick={() => animateFromInline(askQ.trim())}
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
      </div>,
      document.body
    )}
    </>
  );
}
