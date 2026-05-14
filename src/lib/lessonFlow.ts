import { useGraphStore } from '../store/graphStore';
import type { FrameType, LessonMode } from '../types';
import { findCannedDemo, runCannedDemo } from './demoLessons';

// ─────────────────────────────────────────────────────────────────
// DEMO BRANCH — API DISABLED
// ─────────────────────────────────────────────────────────────────
// Every Explain / Animate / prereq / retry on this branch resolves
// to a hand-built canned lesson. The agent pipeline (explainStream,
// createVideo, subscribeVideo) is intentionally not imported here so
// no code path can fall through to a network request. If a phrase
// has no specific canned demo registered, `findCannedDemo` returns
// a polished fallback placeholder.

interface StartLessonOpts {
  sourceText: string;
  question?: string;
  docSummary?: string | null;
  parentId?: string;
  parentTitle?: string;
  frameType?: FrameType;
  force?: LessonMode;
  // When true, add the frame to the graph but don't open it in FramePanel.
  // Used by the canvas-frame inline Explain so spawning a node from the
  // canvas keeps the user on the canvas instead of jumping into the panel.
  noFocus?: boolean;
}

const truncTitle = (t: string) => t.slice(0, 40) + (t.length > 40 ? '…' : '');

export function startLesson(opts: StartLessonOpts): string {
  const { addFrame, setFocused } = useGraphStore.getState();
  const id = crypto.randomUUID();
  const frameType: FrameType = opts.frameType ?? (opts.parentId ? 'child' : 'root');

  addFrame(
    {
      id,
      type: frameType,
      title: truncTitle(opts.sourceText),
      summary: opts.question || 'Generating lesson…',
      sourceText: opts.sourceText,
      parentIds: opts.parentId ? [opts.parentId] : [],
      childIds: [],
      loading: true,
    },
    opts.parentId
  );
  if (!opts.noFocus) setFocused(id);

  void runLesson(id, opts);
  return id;
}

interface StartPrereqOpts {
  childFrameId: string;
  prereqTitle: string;
  prereqBrief: string;
  docSummary?: string | null;
}

export function startPrereqLesson(opts: StartPrereqOpts): string {
  const { addFrame, addEdge, setFocused } = useGraphStore.getState();
  const id = crypto.randomUUID();
  addFrame({
    id,
    type: 'root',
    title: opts.prereqTitle,
    summary: 'Generating prerequisite lesson…',
    sourceText: opts.prereqTitle,
    parentIds: [],
    childIds: [opts.childFrameId],
    loading: true,
  });
  addEdge(id, opts.childFrameId);
  setFocused(id);
  void runLesson(id, {
    sourceText: opts.prereqTitle,
    question: opts.prereqBrief,
    docSummary: opts.docSummary,
  });
  return id;
}

// On the demo branch the inline "Animate" button no longer kicks off a
// Manim render — it just routes through the same canned-demo dispatcher
// as Explain so the user always sees a hand-built lesson.
export function startVideoDirect(opts: StartLessonOpts): string {
  return startLesson(opts);
}

function runLesson(id: string, opts: StartLessonOpts) {
  // The canned-demo dispatcher always returns a CannedDemo (specific
  // match or polished fallback). The API is never called on this branch.
  const demo = findCannedDemo(opts.sourceText, opts.question);
  void runCannedDemo(id, demo);
}
