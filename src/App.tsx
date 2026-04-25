import { PdfViewer } from './components/PdfViewer/PdfViewer';
import { Canvas } from './components/Canvas/Canvas';
import { FramePanel } from './components/Frame/FramePanel';
import { useGraphStore } from './store/graphStore';

function App() {
  const reset = useGraphStore((s) => s.reset);
  const count = useGraphStore((s) => s.nodes.length);
  const focusedId = useGraphStore((s) => s.focusedNodeId);

  return (
    <div className="flex h-screen w-screen flex-col bg-[#07070a] text-neutral-100">
      <header className="relative flex items-center justify-between border-b border-neutral-800/80 bg-[#0a0a0d] px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-[0_4px_20px_-4px_rgba(99,102,241,0.6)]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[13px] font-semibold tracking-tight text-neutral-100">Visual Tutor</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-500">
              {count === 0 ? 'no lessons' : `${count} ${count === 1 ? 'lesson' : 'lessons'}`}
            </span>
          </div>
        </div>
        <button
          onClick={() => {
            if (confirm('Clear all lessons?')) reset();
          }}
          className="rounded-md border border-neutral-800 bg-[#111114] px-2.5 py-1 text-[11px] font-medium text-neutral-400 transition hover:border-neutral-700 hover:text-neutral-200"
        >
          Clear
        </button>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-indigo-500/40 to-transparent" />
      </header>
      <div className="flex flex-1 overflow-hidden">
        <div className="w-1/2 border-r border-neutral-800/80">
          <PdfViewer />
        </div>
        <div className="relative w-1/2">
          <Canvas />
          {focusedId && <FramePanel />}
        </div>
      </div>
    </div>
  );
}

export default App;
