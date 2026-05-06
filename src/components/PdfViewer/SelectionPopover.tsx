import { useEffect, useRef, useState } from 'react';

interface Props {
  x: number;
  y: number;
  text: string;
  onAsk: (question: string) => void;
  onVideo: (brief: string) => void;
  onDismiss: () => void;
}

export function SelectionPopover({ x, y, text, onAsk, onVideo, onDismiss }: Props) {
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onDismiss();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [onDismiss]);

  const submitAsk = () => onAsk(q.trim());
  const submitVideo = () => onVideo(q.trim());
  const hasQ = q.trim().length > 0;

  return (
    <div
      ref={ref}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ left: x, top: y - 12 }}
      className="absolute z-50 -translate-y-full"
    >
      <div className="w-[420px] overflow-hidden rounded-xl border border-neutral-800 bg-[#0d0d11]/95 shadow-[0_20px_50px_-10px_rgba(0,0,0,0.8)] ring-1 ring-white/5 backdrop-blur-xl">
        <div className="border-b border-neutral-800/80 px-3 py-2">
          <div className="flex items-start gap-2">
            <div className="mt-0.5 h-3.5 w-0.5 shrink-0 rounded-full bg-indigo-500" />
            <div className="line-clamp-2 text-[11px] leading-relaxed text-neutral-400">
              {text.slice(0, 160)}{text.length > 160 ? '…' : ''}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2 p-2">
          <textarea
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submitVideo();
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitAsk();
              }
              if (e.key === 'Escape') onDismiss();
            }}
            rows={1}
            placeholder="Ask anything, or press Enter to explain"
            className="resize-none rounded-md border border-neutral-800 bg-[#15151b] px-2.5 py-2 text-[13px] text-neutral-100 placeholder:text-neutral-500 outline-none transition focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/20"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={submitAsk}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-[12px] font-medium text-white shadow-[0_4px_14px_-4px_rgba(99,102,241,0.6)] transition hover:bg-indigo-500"
              title={hasQ ? 'Ask (Enter) — ⌘↵ to animate' : 'Explain (Enter) — ⌘↵ to animate'}
            >
              {hasQ ? 'Ask' : 'Explain'}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 5l7 7-7 7" />
              </svg>
            </button>
            <button
              onClick={submitVideo}
              className="flex items-center gap-1.5 rounded-md border border-neutral-800 bg-[#15151b] px-3 py-2 text-[12px] font-medium text-neutral-200 transition hover:border-indigo-500/50 hover:bg-[#1a1a22] hover:text-indigo-300"
              title="Generate animation"
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
  );
}
