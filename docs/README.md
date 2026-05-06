# AI Visual Learning Tutor — Documentation

An AI tutor that turns highlighted text into a living visual learning graph. Highlight in a PDF, get an interactive lesson — text, interactive HTML, or a Manim animation — connected as a node on a canvas. Highlight inside a lesson to spawn child lessons. Quiz yourself on any concept.

## Documentation map

| Doc | What's in it |
|-----|-------------|
| [getting-started.md](getting-started.md) | Prerequisites, install, env vars, first run |
| [usage.md](usage.md) | Every feature explained: highlight, explain, animate, quiz, navigation, keyboard shortcuts. Includes a learning-graph growth diagram and the lesson-router decision tree. |
| [architecture.md](architecture.md) | System overview (mermaid), request-flow sequence, video state machine, file/module map |
| [api.md](api.md) | HTTP API reference: every endpoint, every event, with sequence diagrams for the streaming `/api/explain` and `/api/video/:id/events` flows |
| [manim-pipeline.md](manim-pipeline.md) | Video generation deep-dive: full pipeline sequence diagram, warm-worker fallback flowchart, prompts, sandbox table, troubleshooting |
| [extending.md](extending.md) | Add lesson types, swap models, customize prompts, add libraries. Includes the model-routing diagram. |

All diagrams are written in [Mermaid](https://mermaid.js.org/) and render natively on GitHub. If you're reading these in a markdown viewer that doesn't support Mermaid, the surrounding text is self-contained.

The local mirror of the Manim Community v0.19 docs lives at [`manim/`](manim/) (555 pages, gitignored). It exists to ground the LLM when generating Manim scripts. See [extending.md](extending.md#refreshing-the-manim-docs-mirror) for how to refresh it.

## What this product does

1. You upload a PDF.
2. Anthropic Claude generates a dense summary that anchors the document's domain.
3. You highlight text. A popover appears with two actions: **Explain** and **Animate**.
4. Claude routes the request to the best lesson type:
   - **text** — beautiful prose lesson
   - **visual\_html** — interactive HTML/CSS/JS lesson with D3, KaTeX, and p5 available
   - **video\_manim** — short cinematic Manim animation with chapter markers
5. The lesson appears as a node on a zoomable canvas. Click any node to enter focus mode. Highlight inside a lesson to spawn a child lesson, building a learning graph.
6. From any frame you can generate a **Quiz** that tests the concept with multiple choice, short answer, and one interactive challenge.

## Tech stack

- **Frontend** — React 19, Vite 8, ReactFlow, Tailwind 3, Zustand, react-pdf
- **Backend** — Node 20+ ESM, Express 5, Anthropic SDK 0.91
- **Video** — Manim Community v0.19 (Python), FFmpeg, LaTeX
- **Model** — `claude-sonnet-4-6` (default; configurable via `ANTHROPIC_MODEL`)

## Project layout

```
ai-tutor/
├── server/                    Express + Anthropic + Manim
│   ├── index.ts               Routes
│   ├── anthropic.ts           SDK client + helpers
│   ├── lessonPrompts.ts       System prompts + tool schemas
│   ├── video.ts               Video job queue, SSE, Manim subprocess
│   └── tmp/                   Per-job scratch (gitignored)
├── src/                       Frontend
│   ├── App.tsx                Top-level layout
│   ├── agent/tutor.ts         API client (fetch + EventSource)
│   ├── components/
│   │   ├── Canvas/            ReactFlow canvas
│   │   ├── Frame/             FrameNode, FramePanel, VideoFramePlayer
│   │   └── PdfViewer/         PDF viewer + selection popover
│   ├── lib/
│   │   ├── layout.ts          Dagre auto-layout
│   │   ├── lessonShell.ts     Iframe shell + lib injection
│   │   └── lessonFlow.ts      Frame creation + lesson orchestration
│   ├── store/                 Zustand stores (graph, document)
│   └── types/                 Shared TS types
├── public/videos/             Rendered MP4 output (gitignored)
├── docs/                      You are here
│   └── manim/                 Mirrored Manim docs (gitignored)
└── package.json
```
