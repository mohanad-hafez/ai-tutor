import { useState } from 'react';
import type { AgentName, AgentStatus, AgentTrace } from '../../types';

interface Props {
  trace: AgentTrace[];
  loading: boolean;
}

const AGENT_META: Record<AgentName, { color: string; ring: string; label: string; role: string }> = {
  memory:        { color: 'bg-cyan-400',    ring: 'ring-cyan-500/30',    label: 'Memory',        role: 'Semantic dedup · embeddings' },
  router:        { color: 'bg-sky-400',     ring: 'ring-sky-500/30',     label: 'Router',        role: 'Pick lesson type' },
  retriever:     { color: 'bg-emerald-400', ring: 'ring-emerald-500/30', label: 'Retriever',     role: 'BM25 over PDF' },
  planner:       { color: 'bg-indigo-400',  ring: 'ring-indigo-500/30',  label: 'Planner',       role: 'Pedagogical beats' },
  author:        { color: 'bg-violet-400',  ring: 'ring-violet-500/30',  label: 'Author',        role: 'Write HTML/CSS/JS' },
  critic:        { color: 'bg-amber-400',   ring: 'ring-amber-500/30',   label: 'Critic',        role: 'Review against plan' },
  refiner:       { color: 'bg-rose-400',    ring: 'ring-rose-500/30',    label: 'Refiner',       role: 'Apply fixes' },
  video_planner: { color: 'bg-fuchsia-400', ring: 'ring-fuchsia-500/30', label: 'Video Planner', role: 'Storyboard scene' },
  video_renderer:{ color: 'bg-teal-400',    ring: 'ring-teal-500/30',    label: 'Renderer',      role: 'Manim render' },
};

const STATUS_DOT: Record<AgentStatus, string> = {
  pending:  'bg-neutral-700',
  running:  'bg-indigo-400 animate-pulse',
  done:     'bg-emerald-400',
  error:    'bg-rose-500',
  skipped:  'bg-neutral-600',
};

function formatMs(ms?: number): string {
  if (!ms && ms !== 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
}

function formatTokens(n?: number): string | null {
  if (!n && n !== 0) return null;
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(1)}k`;
}

export function AgentTracePanel({ trace, loading }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (!trace.length && !loading) return null;

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalMs = trace.reduce((acc, s) => acc + (s.durationMs || 0), 0);
  const totalIn = trace.reduce((acc, s) => acc + (s.tokensIn || 0), 0);
  const totalOut = trace.reduce((acc, s) => acc + (s.tokensOut || 0), 0);
  const cacheRead = trace.reduce((acc, s) => acc + (s.cacheReadTokens || 0), 0);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#0a0a0d]">
      <div className="flex items-center justify-between border-b border-neutral-800/80 bg-[#0d0d11] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-neutral-500">
            Agent pipeline
          </span>
          {loading && (
            <span className="flex items-center gap-1.5 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-[0.1em] text-indigo-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
              live
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] text-neutral-400">
          <span>{formatMs(totalMs)}</span>
          {totalIn > 0 && (
            <span title="input tokens (across all agents)">
              <span className="text-neutral-600">in</span> {formatTokens(totalIn)}
            </span>
          )}
          {totalOut > 0 && (
            <span title="output tokens (across all agents)">
              <span className="text-neutral-600">out</span> {formatTokens(totalOut)}
            </span>
          )}
          {cacheRead > 0 && (
            <span title="cached prompt tokens (90% discount)" className="text-emerald-400/80">
              cache {formatTokens(cacheRead)}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <ol className="relative space-y-2">
          {/* timeline rail */}
          <div className="absolute bottom-2 left-[10px] top-2 w-px bg-neutral-800" />
          {trace.map((step) => {
            const meta = AGENT_META[step.agent];
            const isOpen = expanded.has(step.id);
            const hasDetail = !!(step.detail || step.error);
            return (
              <li key={step.id} className="relative">
                <div
                  className={`group relative flex items-start gap-3 rounded-md border border-transparent px-2 py-1.5 transition ${
                    hasDetail ? 'cursor-pointer hover:border-neutral-800 hover:bg-[#0e0e12]' : ''
                  }`}
                  onClick={hasDetail ? () => toggle(step.id) : undefined}
                >
                  <div className="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center">
                    <span className={`absolute inset-0 rounded-full ring-2 ${meta.ring}`} />
                    <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[step.status]}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-[12px] font-semibold text-neutral-100">
                        {meta.label}
                      </span>
                      <span className="text-[11px] text-neutral-400">
                        {step.label || meta.role}
                      </span>
                      {step.model && (
                        <span className="rounded border border-neutral-800 px-1 py-px font-mono text-[9px] uppercase tracking-[0.08em] text-neutral-500">
                          {step.model.replace('claude-', '').replace('-20', ' 20')}
                        </span>
                      )}
                    </div>
                    {step.preview && (
                      <div className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-neutral-400">
                        {step.preview}
                      </div>
                    )}
                    {isOpen && step.detail && (
                      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-neutral-800 bg-[#0a0a0d] p-2.5 font-mono text-[10.5px] leading-relaxed text-neutral-300">
                        {step.detail}
                      </pre>
                    )}
                    {isOpen && step.error && (
                      <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-md border border-rose-500/40 bg-rose-500/5 p-2.5 font-mono text-[10.5px] leading-relaxed text-rose-300">
                        {step.error}
                      </pre>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-right font-mono text-[10px] text-neutral-500">
                    {step.tokensIn != null && step.tokensIn > 0 && (
                      <span title="input tokens">
                        <span className="text-neutral-700">↓</span>
                        {formatTokens(step.tokensIn)}
                      </span>
                    )}
                    {step.tokensOut != null && step.tokensOut > 0 && (
                      <span title="output tokens">
                        <span className="text-neutral-700">↑</span>
                        {formatTokens(step.tokensOut)}
                      </span>
                    )}
                    <span className="w-12 text-right tabular-nums text-neutral-400">
                      {formatMs(step.durationMs)}
                    </span>
                    {hasDetail && (
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        className={`text-neutral-600 transition ${isOpen ? 'rotate-90 text-indigo-400' : ''}`}
                      >
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
          {loading && (
            <li className="relative flex items-start gap-3 px-2 py-1.5">
              <div className="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-neutral-700" />
              </div>
              <span className="text-[11px] italic text-neutral-600">waiting…</span>
            </li>
          )}
        </ol>
      </div>
    </div>
  );
}
