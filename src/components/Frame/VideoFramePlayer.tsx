import { useRef, useState } from 'react';
import type { FrameData, VideoStage } from '../../types';
import { cancelVideo } from '../../agent/tutor';
import { VideoChat } from './VideoChat';

const STAGE_LABEL: Record<VideoStage, string> = {
  queued: 'Queued',
  planning: 'Planning the animation',
  generating: 'Validating script',
  rendering: 'Rendering with Manim',
  done: 'Done',
  error: 'Failed',
};

export function VideoFramePlayer({ data }: { data: FrameData }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const stage: VideoStage = data.videoStage ?? (data.content?.videoUrl ? 'done' : 'queued');
  const progress = data.videoProgress ?? 0;
  const message = data.videoMessage ?? STAGE_LABEL[stage];

  if (stage === 'error') {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md rounded-lg border border-rose-500/30 bg-rose-500/5 p-6 text-center">
          <div className="mb-2 text-sm font-semibold text-rose-300">Video generation failed</div>
          <div className="text-xs leading-relaxed text-rose-300/80">
            {data.videoError || 'Unknown error'}
          </div>
        </div>
      </div>
    );
  }

  if (stage !== 'done' || !data.content?.videoUrl) {
    const eta = data.videoEtaSec;
    const etaLabel = eta == null
      ? null
      : eta <= 0
        ? 'wrapping up'
        : eta < 60
          ? `~${eta}s remaining`
          : `~${Math.round(eta / 60)}m remaining`;
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="mb-3 flex items-center gap-3">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-800 border-t-indigo-500" />
            <div className="flex-1">
              <div className="text-sm font-medium text-neutral-200">{message}</div>
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-500">
                <span>{stage}</span>
                {etaLabel && <span className="text-indigo-400">· {etaLabel}</span>}
              </div>
            </div>
            <div className="font-mono text-[11px] text-neutral-400">{progress}%</div>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-4 text-[11px] leading-relaxed text-neutral-500">
            Manim is rendering your concept as a short animation. This usually takes 20–60 seconds.
          </div>
          <CancelButton frameId={data.id} jobId={data.videoJobId} />
        </div>
      </div>
    );
  }

  const chapters = data.content.videoChapters ?? [];

  const seekTo = (t: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = t;
      void videoRef.current.play();
    }
  };

  return (
    <div className="flex h-full flex-col bg-black">
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          src={data.content.videoUrl}
          controls
          autoPlay
          onTimeUpdate={(e) => setCurrentTime((e.target as HTMLVideoElement).currentTime)}
          className="max-h-full max-w-full"
        />
      </div>
      {chapters.length > 0 && (
        <div className="shrink-0 border-t border-neutral-800/80 bg-[#0a0a0d] px-4 py-3">
          <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.12em] text-neutral-500">
            Chapters
          </div>
          <div className="flex flex-wrap gap-2">
            {chapters.map((c, i) => {
              const next = chapters[i + 1]?.t ?? Number.POSITIVE_INFINITY;
              const active = currentTime >= c.t && currentTime < next;
              return (
                <button
                  key={i}
                  onClick={() => seekTo(c.t)}
                  className={`flex items-center gap-2 rounded-md border px-2.5 py-1 text-[11px] transition ${
                    active
                      ? 'border-indigo-500/60 bg-indigo-500/10 text-indigo-200'
                      : 'border-neutral-800 bg-[#0d0d11] text-neutral-300 hover:border-neutral-700'
                  }`}
                >
                  <span className="font-mono text-[10px] text-neutral-500">
                    {formatTime(c.t)}
                  </span>
                  <span className="truncate">{c.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="shrink-0">
        <VideoChat data={data} />
      </div>
    </div>
  );
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function CancelButton({ frameId, jobId }: { frameId: string; jobId?: string }) {
  const [loading, setLoading] = useState(false);
  if (!jobId) return null;
  void frameId; // server-side cancel updates the frame via SSE
  return (
    <div className="mt-3 flex justify-center">
      <button
        disabled={loading}
        onClick={async () => {
          setLoading(true);
          try { await cancelVideo(jobId); } catch { /* ignore */ }
          setLoading(false);
        }}
        className="rounded-md border border-neutral-800 bg-[#0d0d11] px-3 py-1.5 text-[11px] font-medium text-neutral-400 transition hover:border-rose-500/40 hover:text-rose-300 disabled:opacity-50"
      >
        {loading ? 'Cancelling…' : 'Cancel'}
      </button>
    </div>
  );
}
