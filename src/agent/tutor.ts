import type { FrameContent } from '../types';

export interface ExplainRequest {
  text: string;
  question?: string;
  docSummary?: string;
  parentTitle?: string;
}

export interface ExplainResponse {
  title: string;
  summary: string;
  content: FrameContent;
}

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

export async function explain(req: ExplainRequest): Promise<ExplainResponse> {
  const r = await fetch(`${API_BASE}/explain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!r.ok) throw new Error(`explain failed: ${r.status}`);
  return r.json();
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

export async function summarizeDoc(text: string): Promise<{ summary: string }> {
  const r = await fetch(`${API_BASE}/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!r.ok) throw new Error(`summarize failed: ${r.status}`);
  return r.json();
}
