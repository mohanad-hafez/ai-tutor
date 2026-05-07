import { useGraphStore } from '../store/graphStore';
import { useDocumentStore } from '../store/documentStore';
import type { AgentTrace, FrameType, LessonMode } from '../types';
import { explainStream, createVideo, subscribeVideo } from '../agent/tutor';

interface StartLessonOpts {
  sourceText: string;
  question?: string;
  docSummary?: string | null;
  parentId?: string;
  parentTitle?: string;
  frameType?: FrameType;
  force?: LessonMode;
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
  setFocused(id);

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

export function startVideoDirect(opts: StartLessonOpts): string {
  const { addFrame, updateFrame, setFocused } = useGraphStore.getState();
  const id = crypto.randomUUID();
  addFrame(
    {
      id,
      type: 'video',
      title: truncTitle(opts.sourceText),
      summary: opts.question || 'Generating animation…',
      sourceText: opts.sourceText,
      parentIds: opts.parentId ? [opts.parentId] : [],
      childIds: [],
      loading: true,
      mode: 'video_manim',
      videoStage: 'queued',
      videoProgress: 0,
      videoMessage: 'Queued',
    },
    opts.parentId
  );
  setFocused(id);

  void (async () => {
    try {
      const { jobId } = await createVideo({
        text: opts.sourceText,
        question: opts.question,
        docSummary: opts.docSummary || undefined,
        parentTitle: opts.parentTitle,
      });
      updateFrame(id, { videoJobId: jobId });
      attachVideoSubscription(id, jobId);
    } catch (err) {
      updateFrame(id, {
        loading: false,
        videoStage: 'error',
        videoError: (err as Error).message,
        summary: 'Error: ' + (err as Error).message,
      });
    }
  })();

  return id;
}

function runLesson(id: string, opts: StartLessonOpts) {
  const { updateFrame, nodes, setFocused } = useGraphStore.getState();
  const { docId } = useDocumentStore.getState();

  // Cross-lesson memory: send the last 5 lessons so the router and planner
  // know what the learner has already seen (avoid repetition + enable
  // back-references like "you saw X"). Includes the frame id so the
  // server-side Memory agent can emit a redirect to an existing frame.
  const recentLessons = nodes
    .filter((n) => n.id !== id && (n.data.title || n.data.sourceText))
    .slice(-8)
    .map((n) => ({
      id: n.id,
      title: n.data.title,
      sourceText: n.data.sourceText?.slice(0, 240),
    }));

  explainStream(
    {
      text: opts.sourceText,
      question: opts.question,
      parentTitle: opts.parentTitle,
      docSummary: opts.docSummary || undefined,
      docId: docId || undefined,
      force: opts.force,
      recentLessons,
    },
    {
      onAgentStep: (step: AgentTrace) => {
        const cur = useGraphStore.getState().nodes.find((n) => n.id === id)?.data.trace || [];
        const idx = cur.findIndex((s) => s.id === step.id);
        const next = idx >= 0
          ? [...cur.slice(0, idx), step, ...cur.slice(idx + 1)]
          : [...cur, step];
        updateFrame(id, { trace: next });
      },
      onPartial: (p) => {
        // Only stream metadata (title, summary, mode, prerequisites) into
        // the frame. Skip html/css/js — re-creating the iframe on every
        // partial cancels in-flight CDN script loads, so the final
        // iframe sometimes mounts before Plotly/D3 finish loading and
        // user code crashes with 'Plotly is not defined'. The trace
        // panel is the loading view; the iframe mounts once on complete
        // with all scripts ready.
        const patch: Record<string, unknown> = {};
        if (p.title) patch.title = p.title;
        if (p.summary) patch.summary = p.summary;
        if (p.mode) patch.mode = p.mode;
        if (p.prerequisites) patch.prerequisites = p.prerequisites;
        if (Object.keys(patch).length) updateFrame(id, patch);
      },
      onComplete: (res) => {
        // Memory agent flagged this as a duplicate of an existing frame —
        // throw away the placeholder we just created and focus the original.
        if (res.mode === 'redirect') {
          const target = useGraphStore.getState().nodes.find((n) => n.id === res.redirectFrameId);
          if (target) {
            useGraphStore.getState().removeFrame(id);
            setFocused(res.redirectFrameId);
            return;
          }
          // Fallback if the target somehow disappeared: show a friendly summary.
          updateFrame(id, {
            loading: false,
            summary: `Already covered by "${res.matchTitle}".`,
          });
          return;
        }
        if (res.mode === 'video_manim') {
          updateFrame(id, {
            type: 'video',
            title: res.title,
            summary: res.summary,
            mode: 'video_manim',
            videoJobId: res.jobId,
            videoStage: 'queued',
            videoProgress: 0,
            videoMessage: 'Queued',
            prerequisites: res.prerequisites,
            content: undefined,
            loading: true,
          });
          attachVideoSubscription(id, res.jobId);
          return;
        }
        updateFrame(id, {
          title: res.title,
          summary: res.summary,
          content: res.content,
          mode: res.mode,
          loading: false,
          prerequisites: res.prerequisites,
        });
      },
      onError: (msg) => {
        updateFrame(id, {
          summary: 'Error: ' + msg,
          loading: false,
        });
      },
    }
  );
}

function attachVideoSubscription(frameId: string, jobId: string) {
  const { updateFrame } = useGraphStore.getState();
  subscribeVideo(jobId, {
    onStage: ({ stage, progress, message, etaSec }) => {
      updateFrame(frameId, {
        videoStage: stage,
        videoProgress: progress,
        videoMessage: message,
        videoEtaSec: etaSec,
      });
    },
    onDone: ({ videoUrl, durationSec, chapters, title, summary }) => {
      const patch: Record<string, unknown> = {
        videoStage: 'done',
        videoProgress: 100,
        videoMessage: 'Done',
        loading: false,
        content: { videoUrl, videoDurationSec: durationSec, videoChapters: chapters },
      };
      if (title) patch.title = title;
      if (summary) patch.summary = summary;
      updateFrame(frameId, patch);
    },
    onError: (message) => {
      updateFrame(frameId, {
        videoStage: 'error',
        videoError: message,
        loading: false,
        summary: 'Error: ' + message,
      });
    },
  });
}
