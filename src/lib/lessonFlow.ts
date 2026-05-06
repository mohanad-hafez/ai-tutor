import { useGraphStore } from '../store/graphStore';
import type { FrameType, LessonMode } from '../types';
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
  const { updateFrame } = useGraphStore.getState();
  explainStream(
    {
      text: opts.sourceText,
      question: opts.question,
      parentTitle: opts.parentTitle,
      docSummary: opts.docSummary || undefined,
      force: opts.force,
    },
    {
      onPartial: (p) => {
        const patch: Record<string, unknown> = {};
        if (p.title) patch.title = p.title;
        if (p.summary) patch.summary = p.summary;
        if (p.mode) patch.mode = p.mode;
        if (p.prerequisites) patch.prerequisites = p.prerequisites;
        // Show in-progress HTML / CSS / JS so the iframe can render progressively.
        if (p.mode !== 'video_manim' && (p.html || p.css || p.js)) {
          patch.content = {
            html: p.html || '',
            css: p.css || '',
            js: '', // skip JS until final to avoid running half-written scripts
          };
        }
        if (Object.keys(patch).length) updateFrame(id, patch);
      },
      onComplete: (res) => {
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
