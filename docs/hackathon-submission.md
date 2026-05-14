---
title: "Hackathon Round 2 Submission"
sidebar_label: "🏆 Hackathon Submission"
sidebar_position: 0
---

# Round 2 Submission — AI Visual Learning Tutor

## Architecture Sketch

![Hackathon Architecture Diagram](/img/hackathon-architecture.svg)

## 1. Agentic Solution Concept

### What the Agent Does

**AI Visual Learning Tutor** is a multi-agent system that turns any highlighted text in a PDF into a personalized, interactive lesson — automatically choosing the best format (interactive HTML widget, Manim animation, or prose) and generating it end-to-end without user configuration.

A learner highlights a passage → the agent pipeline runs → a lesson node appears on their canvas. Highlights inside lessons spawn child lessons, building a personal knowledge graph.

---

### What Decisions the Agents Make

| Decision | Agent | How |
|---|---|---|
| **Is this concept already known?** | Memory | Embeds query, cosine-matches existing canvas frames (MiniLM-L6). Redirects if score ≥ 0.78. |
| **Has a similar lesson been generated before?** | Memory | Semantic cache lookup across all prior sessions. Reuses if score ≥ 0.82. |
| **What lesson format fits best?** | Router | Chooses `visual_html` (default), `video_manim`, or `text` based on concept type. Tool-use call to Claude Haiku. |
| **What document context is relevant?** | Retriever | BM25 top-4 chunks from the indexed PDF. Zero LLM cost. |
| **How should the lesson be structured?** | Planner | Produces 2–4 ordered teaching beats with visualization ideas. Claude Sonnet. |
| **Write the lesson body** | Author | Streams HTML/CSS/JS (or prose) following the plan. Partial JSON snapshots populate the iframe live. |
| **Is the lesson correct and complete?** | Critic | Reviews against the plan: pedagogical fit, accuracy, JS bugs, viz quality. Claude Haiku. |
| **Fix any flagged issues** | Refiner | Applies Critic's specific fixes. Only runs if Critic flags severity ≠ none. Claude Sonnet. |

---

### Single-Agent or Multi-Agent?

**Multi-agent** — 7 specialized agents in a linear pipeline with two conditional branches:

```
Memory → Router → Retriever → Planner → Author → Critic → Refiner
           ↓ (redirect/semantic hit: short-circuit)          ↓ (pass: skip Refiner)
```

- **Pattern**: ReAct + Reflexion
- **Forced tool-use**: every agent calls a typed structured tool (no free-form output)
- **Live transparency**: every agent step streams as an SSE `agent_step` event — the user sees the pipeline running in real time

---

## 2. Architecture Sketch

See `docs/figures/agent-pipeline.svg` (Figure 1) and `docs/figures/system-overview.svg` (Figure 2).

### Main Components

#### Agents (server/agents.ts)
| Agent | Model | Role |
|---|---|---|
| Memory | MiniLM-L6 (local) | Semantic dedup, redirect, cache reuse |
| Router | Claude Haiku | Mode selection + lesson intent |
| Retriever | BM25 (local) | RAG grounding from PDF |
| Planner | Claude Sonnet | Pedagogical beat structure |
| Author | Claude Sonnet | Streaming HTML/CSS/JS generation |
| Critic | Claude Haiku | Quality review against plan |
| Refiner | Claude Sonnet | Conditional fix pass |

#### Tools (Structured Tool-Use)
- `route_lesson` → `{mode, intent, reason}`
- `emit_plan` → `{title, summary, beats[], prerequisites[], manim_brief?}`
- `emit_content` → `{html, css, js}`
- `critique_lesson` → `{ok, severity, issues[], praise}`

#### Memory
- **Semantic vector index** — MiniLM-L6 embeddings, cosine similarity, persisted across sessions
- **Hash result cache** — SHA256(inputs) → JSON + mp4, ~30 ms hit vs ~30 s miss
- **BM25 document index** — per-PDF, 600-token windows, stride 520

#### APIs
- `POST /api/explain` → SSE stream (`agent_step`, `partial`, `complete`)
- `POST /api/video` → queued Manim render job
- `GET /api/video/:id/events` → SSE render progress
- `DELETE /api/video/:id` → cancel (SIGTERM)
- `POST /api/summarize` → document summary + BM25 index build
- `POST /api/quiz` → interactive quiz generation

#### Interaction Flow
```
User highlights text in PDF
        ↓
POST /api/explain (SSE)
        ↓
[Memory] embed query → check canvas frames → check semantic cache
        ↓ miss
[Router] pick mode (visual_html / video_manim / text)
        ↓
[Retriever] BM25 top-4 chunks from PDF
        ↓
[Planner] 2–4 teaching beats + viz ideas → stream partial to client
        ↓
  ┌─────┴──────────────────┐
video_manim            text / visual_html
  ↓                        ↓
Manim worker          [Author] stream HTML/CSS/JS → iframe live preview
Python render              ↓
gTTS narration        [Critic] review vs plan
FFmpeg → mp4               ↓ issues found?
SSE progress          [Refiner] apply fixes (conditional)
  └──────────┬─────────────┘
             ↓
     write to hash cache + semantic index
             ↓
     send 'complete' SSE → ReactFlow node appears on canvas
```

### System Layers

| Layer | Components |
|---|---|
| **Browser** | PDF Viewer (react-pdf), Lesson Canvas (ReactFlow DAG), Sandboxed Iframe (D3/KaTeX/p5), Agent Trace Panel |
| **Server** | Express 5, Multi-agent orchestrator, SSE endpoints, BM25 index, Hash cache, Manim job queue |
| **Anthropic API** | claude-sonnet-4-6 (Planner, Author, Refiner), claude-haiku-4-5 (Router, Critic, Quiz) |
| **Render** | manim_worker.py (long-lived Python), Regex sandbox, gTTS, FFmpeg → mp4 |
