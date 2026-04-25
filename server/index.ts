import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';

const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' }));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAIN_MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-7-sonnet-20250219';
const SUMMARY_MODEL = process.env.ANTHROPIC_SUMMARY_MODEL || MAIN_MODEL;

const SYSTEM_PROMPT = `You are an elite tutor. The user highlighted text from a specific document and may have asked a question. You produce a SELF-CONTAINED HTML/CSS/JS lesson page that deeply explains the concept — grounded in the document they're reading.

OUTPUT — strict JSON, no markdown fences:
{ "title": string, "summary": string, "html": string, "css": string, "js": string }
- title
- summary
- html: body content only — no <html>/<head>/<body>/<style>/<script> tags.
- css: styles only.
- js: vanilla JS only — no <script> tags. Page is fresh; you control everything.

GROUNDING — read carefully:
- A document summary is provided. Interpret the highlighted text IN THE CONTEXT OF THAT DOCUMENT.

LESSON DESIGN — this is the bar:
- Focus on producing exceptionally clear, logical, and insightful textual explanations first.
- Only include interactive visualizations or animations if they are STRICTLY NECESSARY to understand a spatial, dynamic, or highly complex concept. Do not visualize for the sake of it. If an explanation is better as text, use beautiful typography and layout instead of forcing an animation.
- If you use visualizations, they must be highly accurate and make perfect sense.
- Accent: indigo (#818cf8 for highlights, #6366f1 for buttons). Use sparingly.
- Generous whitespace, max-width ~720px content column centered, line-height 1.6, sans-serif system font stack.
- Smooth transitions, subtle hover states, no harsh contrasts. Rounded corners (8–12px). No emojis in rendered output.
- Charts/SVGs use the dark palette: dark backgrounds, light strokes, indigo accents.

Respond ONLY with the JSON object.`;

const SUMMARY_PROMPT = `You produce a concise but information-dense summary of a document so a downstream tutor knows the domain, scope, and key concepts. Output plain text, ~150–250 words. Cover: what the document is about, the field/domain (be specific — e.g. "tabular data analysis in pandas", not just "data"), key concepts and terms used, the apparent audience, and any unusual conventions or definitions used in the document. Do NOT add headings or bullet points — just dense prose. Do NOT invent content not in the document.`;

app.post('/api/summarize', async (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text required' });
  }
  const trimmed = text.length > 80000 ? text.slice(0, 80000) : text;
  try {
    const completion = await client.messages.create({
      model: SUMMARY_MODEL,
      system: SUMMARY_PROMPT,
      max_tokens: 1024,
      messages: [
        { role: 'user', content: trimmed },
      ],
    });
    const summary = (completion.content[0] as any).text.trim() || '';
    res.json({ summary });
  } catch (err) {
    console.error('summarize error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/explain', async (req, res) => {
  const { text, question, parentTitle, docSummary } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });

  const userMsg = [
    docSummary ? `DOCUMENT SUMMARY (use this to anchor the domain):\n${docSummary}` : null,
    parentTitle ? `Parent concept already explained: ${parentTitle}` : null,
    `Highlighted text from the document:\n"""${text}"""`,
    question
      ? `User's specific question: """${question}"""`
      : `The user did not ask a specific question — give a thorough explanation appropriate to the highlighted text within the document's domain.`,
    `Build the interactive dark-mode lesson page now.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const completion = await client.messages.create({
      model: MAIN_MODEL,
      system: SYSTEM_PROMPT,
      max_tokens: 8192,
      messages: [
        { role: 'user', content: userMsg },
      ],
    });

    const raw = (completion.content[0] as any).text || '{}';
    const cleaned = raw.replace(/```json\n?|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    res.json({
      title: parsed.title || 'Concept',
      summary: parsed.summary || '',
      content: {
        html: parsed.html || '',
        css: parsed.css || '',
        js: parsed.js || '',
      },
    });
  } catch (err) {
    console.error('explain error:', err);
    res.status(500).json({ error: (err as Error).message || 'generation failed' });
  }
});

app.post('/api/quiz', async (req, res) => {
  const { title, summary, sourceText, docSummary } = req.body || {};
  const userMsg = [
    docSummary ? `DOCUMENT SUMMARY:\n${docSummary}` : null,
    `Concept: ${title}`,
    `Summary: ${summary}`,
    sourceText ? `Source text: ${sourceText}` : null,
    `Generate an interactive dark-mode quiz lesson that tests understanding of this concept in the context of the document. Mix multiple choice, short answer, and at least one interactive challenge (e.g. drag-to-match, fill-in, sort). Show immediate feedback with explanations on each answer.`,
  ]
    .filter(Boolean)
    .join('\n\n');
  try {
    const completion = await client.messages.create({
      model: MAIN_MODEL,
      system: SYSTEM_PROMPT,
      max_tokens: 8192,
      messages: [
        { role: 'user', content: userMsg },
      ],
    });
    const raw = (completion.content[0] as any).text || '{}';
    const cleaned = raw.replace(/```json\n?|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    res.json({
      title: parsed.title || 'Quiz',
      summary: parsed.summary || '',
      content: {
        html: parsed.html || '',
        css: parsed.css || '',
        js: parsed.js || '',
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, '127.0.0.1', () => console.log(`tutor server on :${PORT}`));
