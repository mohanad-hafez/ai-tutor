import type { AgentTrace, FrameContent, LessonMode, LessonPrereq, VideoChapter, VideoStage } from '../types';

export interface ExplainRequest {
  text: string;
  question?: string;
  docSummary?: string;
  docId?: string;
  parentTitle?: string;
  force?: LessonMode;
  recentLessons?: { id?: string; title: string; sourceText?: string }[];
}

export type ExplainResponse =
  | {
      mode: 'text' | 'visual_html';
      title: string;
      summary: string;
      content: FrameContent;
      prerequisites?: LessonPrereq[];
      semanticHit?: { matchedQuery: string; score: number };
    }
  | {
      mode: 'video_manim';
      title: string;
      summary: string;
      jobId: string;
      prerequisites?: LessonPrereq[];
      semanticHit?: { matchedQuery: string; score: number };
    }
  | {
      mode: 'redirect';
      redirectFrameId: string;
      matchTitle: string;
      score: number;
    };

export interface VideoRequest {
  text: string;
  question?: string;
  docSummary?: string;
  parentTitle?: string;
  brief?: string;
}

export interface VideoStageEvent {
  stage: VideoStage;
  progress: number;
  message: string;
  etaSec?: number;
}

export interface VideoDoneEvent {
  videoUrl: string;
  durationSec?: number;
  chapters?: VideoChapter[];
  title?: string;
  summary?: string;
}

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

export interface ExplainPartial {
  mode?: LessonMode;
  title?: string;
  summary?: string;
  html?: string;
  css?: string;
  js?: string;
  manim_brief?: string;
  prerequisites?: LessonPrereq[];
}

export interface ExplainHandlers {
  onPartial?: (p: ExplainPartial) => void;
  onAgentStep?: (t: AgentTrace) => void;
  onComplete?: (r: ExplainResponse) => void;
  onError?: (msg: string) => void;
}

export function explainStream(req: ExplainRequest, h: ExplainHandlers): () => void {
  const ctrl = new AbortController();
  (async () => {
    try {
      const r = await fetch(`${API_BASE}/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(req),
        signal: ctrl.signal,
      });
      if (!r.ok || !r.body) {
        h.onError?.(`explain failed: ${r.status}`);
        return;
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let receivedComplete = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let event = 'message';
          let data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) event = line.slice(7);
            else if (line.startsWith('data: ')) data = line.slice(6);
          }
          if (!data) continue;
          if (event === 'partial') {
            try { h.onPartial?.(JSON.parse(data)); } catch { /* ignore */ }
          } else if (event === 'agent_step') {
            try { h.onAgentStep?.(JSON.parse(data)); } catch { /* ignore */ }
          } else if (event === 'complete') {
            try {
              h.onComplete?.(JSON.parse(data));
              receivedComplete = true;
            } catch { /* ignore */ }
          } else if (event === 'error') {
            try {
              const d = JSON.parse(data);
              h.onError?.(d.message || 'error');
            } catch { h.onError?.('stream error'); }
          }
        }
      }
      if (!receivedComplete && !ctrl.signal.aborted) {
        h.onError?.('stream ended without completion');
      }
    } catch (err) {
      if (!ctrl.signal.aborted) h.onError?.((err as Error).message);
    }
  })();
  return () => ctrl.abort();
}

export async function quiz(req: {
  title: string;
  summary: string;
  sourceText?: string;
  docSummary?: string;
}): Promise<ExplainResponse> {
  const r = await fetch(`${API_BASE}/quiz`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!r.ok) throw new Error(`quiz failed: ${r.status}`);
  return r.json();
}

export async function summarizeDoc(text: string): Promise<{ summary: string; docId: string; chunkCount: number }> {
  const r = await fetch(`${API_BASE}/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!r.ok) throw new Error(`summarize failed: ${r.status}`);
  return r.json();
}

export async function cancelVideo(jobId: string): Promise<void> {
  await fetch(`${API_BASE}/video/${jobId}`, { method: 'DELETE' });
}

export async function createVideo(req: VideoRequest): Promise<{ jobId: string }> {
  const r = await fetch(`${API_BASE}/video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!r.ok) throw new Error(`video request failed: ${r.status}`);
  return r.json();
}

export interface VideoSubscriptionHandlers {
  onStage?: (e: VideoStageEvent) => void;
  onDone?: (e: VideoDoneEvent) => void;
  onError?: (msg: string) => void;
}

export function subscribeVideo(jobId: string, h: VideoSubscriptionHandlers): () => void {
  const url = `${API_BASE}/video/${jobId}/events`;
  const es = new EventSource(url);
  es.addEventListener('stage', (ev: MessageEvent) => {
    try { h.onStage?.(JSON.parse(ev.data)); } catch { /* ignore */ }
  });
  es.addEventListener('done', (ev: MessageEvent) => {
    try { h.onDone?.(JSON.parse(ev.data)); } catch { /* ignore */ }
    es.close();
  });
  es.addEventListener('error', (ev: MessageEvent) => {
    try {
      const data = JSON.parse((ev as MessageEvent).data || '{}');
      if (data.message) h.onError?.(data.message);
    } catch {
      // EventSource itself errored (network/closed) — ignore unless not yet done
    }
  });
  return () => es.close();
}
