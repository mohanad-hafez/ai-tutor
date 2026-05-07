# AI Visual Learning Tutor

Highlight any text in a PDF and get an interactive lesson — text, HTML, or Manim animation — connected as a node on a learning graph. Highlight inside a lesson to spawn child lessons. Quiz yourself on any concept.

![Multi-agent lesson generation pipeline](docs/figures/agent-pipeline.svg)

```bash
npm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY
npm run dev
```

Then open <http://localhost:5173/>.

## Documentation

Full docs live in [`docs/`](docs/):

- [Getting started](docs/getting-started.md) — prerequisites, install, env vars, first lesson
- [Usage guide](docs/usage.md) — every feature, every keyboard shortcut
- [Architecture](docs/architecture.md) — system overview, data flow, file map
- [API reference](docs/api.md) — Express server endpoints
- [Manim pipeline](docs/manim-pipeline.md) — how video generation works
- [Extending](docs/extending.md) — customize prompts, add lesson types, swap models

## Stack

React 19 + Vite 8 + ReactFlow + Tailwind, Express 5 + Anthropic SDK + Manim Community.

## Prerequisites

Node 20.11+, Python 3.10+ with `manim` installed, FFmpeg, and (optional) LaTeX. See [getting-started.md](docs/getting-started.md#prerequisites) for the full list.
