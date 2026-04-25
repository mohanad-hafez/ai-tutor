import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import OpenAI from 'openai';

const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' }));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAIN_MODEL = process.env.OPENAI_MODEL || 'gpt-5';
const SUMMARY_MODEL = process.env.OPENAI_SUMMARY_MODEL || MAIN_MODEL;

const SYSTEM_PROMPT = `You are an elite visual tutor. The user highlighted text from a specific document and may have asked a question. You produce a SELF-CONTAINED interactive HTML/CSS/JS lesson page that takes the user on a real learning journey through the concept — grounded in the document they're reading.

OUTPUT — strict JSON, no markdown fences:
{ "title": string, "summary": string, "html": string, "css": string, "js": string }
- title: max 8 words.
- summary: one sentence, max 25 words.
- html: body content only — no <html>/<head>/<body>/<style>/<script> tags.
- css: styles only.
- js: vanilla JS only — no <script> tags. Page is fresh; you control everything.

GROUNDING — read carefully:
- A document summary is provided. Interpret the highlighted text IN THE CONTEXT OF THAT DOCUMENT. If the document is about tabular data, "downsampling" means row/sample reduction in tables, NOT signal processing. If it's about audio, then signals. Match the domain. Never explain a generic textbook meaning that contradicts the document's domain.
- If the user asked a specific question, the lesson must directly and thoroughly answer it.

LESSON DESIGN — this is the bar:
- A real journey, not a single widget. 5–9 sections that build on each other: hook → intuition → mechanism → worked example → interactive exploration → edge cases / pitfalls → recap.
- Every major idea is paired with a custom visualization or animation when it helps. Examples: animated SVG diagrams, draggable sliders that update a chart in real time, step-through walkthroughs with prev/next buttons, before/after toggles, particle simulations on canvas, mini-games, hover-to-reveal annotations, animated transitions between states. Build whatever is genuinely illuminating.
- Animations should run smoothly (CSS transitions, requestAnimationFrame). Interactive controls should give immediate visual feedback.
- Use real numbers and concrete examples drawn from the document's domain when possible.
- Quality bar: feels like a polished explainer from 3blue1brown / Bartosz Ciechanowski — depth, craft, beauty. Not a toy.

VISUAL DESIGN — DARK MODE, mandatory:
- Background: #0a0a0a (page) with section cards on #141414 / #1a1a1a. Borders #262626. Text #e5e5e5, secondary #a3a3a3, muted #737373.
- Accent: indigo (#818cf8 for highlights, #6366f1 for buttons). Use sparingly.
- Generous whitespace, max-width ~720px content column centered, line-height 1.6, sans-serif system font stack.
- Smooth transitions, subtle hover states, no harsh contrasts. Rounded corners (8–12px). No emojis in rendered output.
- Charts/SVGs use the dark palette: dark backgrounds, light strokes, indigo accents.

CONSTRAINTS:
- No external scripts, no fetch, no remote images. SVG, CSS, canvas only.
- Self-contained, runs offline.
- Total size under ~60KB.

Respond ONLY with the JSON object.`;

const SUMMARY_PROMPT = `You produce a concise but information-dense summary of a document so a downstream tutor knows the domain, scope, and key concepts. Output plain text, ~150–250 words. Cover: what the document is about, the field/domain (be specific — e.g. "tabular data analysis in pandas", not just "data"), key concepts and terms used, the apparent audience, and any unusual conventions or definitions used in the document. Do NOT add headings or bullet points — just dense prose. Do NOT invent content not in the document.`;

app.post('/api/summarize', async (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text required' });
  }
  const trimmed = text.length > 80000 ? text.slice(0, 80000) : text;
  try {
    const completion = await client.chat.completions.create({
      model: SUMMARY_MODEL,
      messages: [
        { role: 'system', content: SUMMARY_PROMPT },
        { role: 'user', content: trimmed },
      ],
    });
    const summary = completion.choices[0]?.message?.content?.trim() || '';
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
    const completion = await client.chat.completions.create({
      model: MAIN_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw);
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
    const completion = await client.chat.completions.create({
      model: MAIN_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}');
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
app.listen(PORT, () => console.log(`tutor server on :${PORT}`));
