import { Handle, Position, useStore, type NodeProps } from 'reactflow';
import type { FrameData } from '../../types';
import { useGraphStore } from '../../store/graphStore';

const typeBadge: Record<FrameData['type'], { label: string; cls: string; bar: string }> = {
  root:        { label: 'Lesson',      cls: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20',  bar: 'bg-indigo-500' },
  child:       { label: 'Sublesson',   cls: 'bg-sky-500/10 text-sky-300 border-sky-500/20',           bar: 'bg-sky-500' },
  quiz:        { label: 'Quiz',        cls: 'bg-amber-500/10 text-amber-300 border-amber-500/20',     bar: 'bg-amber-500' },
  remediation: { label: 'Review',      cls: 'bg-rose-500/10 text-rose-300 border-rose-500/20',        bar: 'bg-rose-500' },
  summary:     { label: 'Summary',     cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20', bar: 'bg-emerald-500' },
};

const zoomSelector = (s: { transform: number[] }) => s.transform[2];

export function FrameNode({ data, id }: NodeProps<FrameData>) {
  const setFocused = useGraphStore((s) => s.setFocused);
  const focusedId = useGraphStore((s) => s.focusedNodeId);
  const zoom = useStore(zoomSelector);
  const isFocused = focusedId === id;
  const showPreview = zoom >= 0.35;
  const badge = typeBadge[data.type];

  return (
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
              generating
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
            {data.content?.html && !data.loading ? (
              <iframe
                title={data.title}
                srcDoc={buildSrcDoc(data.content)}
                className="pointer-events-none border-0"
                style={{
                  transform: 'scale(0.42)',
                  transformOrigin: 'top left',
                  width: 'calc(100% / 0.42)',
                  height: 'calc(176px / 0.42)',
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
  );
}

function buildSrcDoc(c: { html?: string; css?: string; js?: string }) {
  const baseCss = `html,body{background:#0a0a0d;color:#e5e5e5;}body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:14px;line-height:1.55;}h1,h2,h3{color:#f5f5f5;}*{box-sizing:border-box;}`;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/><style>${baseCss}${c.css ?? ''}</style></head><body>${c.html ?? ''}<script>${c.js ?? ''}<\/script></body></html>`;
}
