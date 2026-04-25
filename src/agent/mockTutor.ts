import type { FrameContent } from '../types';

export interface ExplainRequest {
  text: string;
  context?: string;
  parentTitle?: string;
}

export interface ExplainResponse {
  title: string;
  summary: string;
  content: FrameContent;
}

export async function mockExplain(req: ExplainRequest): Promise<ExplainResponse> {
  await new Promise((r) => setTimeout(r, 600));

  const safe = req.text.slice(0, 60).replace(/[<>&]/g, '');
  const html = `
    <div class="card">
      <h1>${safe}</h1>
      <p>This is a placeholder explanation. The real tutor will generate an interactive visual lesson here.</p>
      <button id="btn">Click to count: <span id="n">0</span></button>
    </div>
  `;
  const css = `
    body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; background: linear-gradient(135deg,#faf5ff,#ede9fe); color: #1f2937; }
    .card { background: white; padding: 24px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    h1 { font-size: 22px; margin: 0 0 12px; color: #6b21a8; }
    p { line-height: 1.5; color: #4b5563; }
    button { margin-top: 16px; padding: 10px 16px; background: #8b5cf6; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; }
    button:hover { background: #7c3aed; }
  `;
  const js = `
    let n = 0;
    document.getElementById('btn').addEventListener('click', () => {
      n++;
      document.getElementById('n').textContent = n;
    });
  `;

  return {
    title: req.text.split(/\s+/).slice(0, 6).join(' ') || 'Concept',
    summary: `Explanation of: ${safe}`,
    content: { html, css, js },
  };
}
