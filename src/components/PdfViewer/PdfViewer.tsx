import { useState, useCallback, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { useDocumentStore } from '../../store/documentStore';
import { useTextSelection } from './useTextSelection';
import { SelectionPopover } from './SelectionPopover';
import { HighlightOverlays } from './HighlightOverlays';
import { summarizeDoc } from '../../agent/tutor';
import { startLesson, startVideoDirect } from '../../lib/lessonFlow';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export function PdfViewer() {
  const { doc, setDoc, summary, summarizing, setSummary, setSummarizing } =
    useDocumentStore();
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const { selection, clear } = useTextSelection(containerRef);

  const onFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setDoc({
        id: crypto.randomUUID(),
        filename: file.name,
        file,
        numPages: 0,
      });
      setNumPages(0);
    },
    [setDoc]
  );

  const onLoadSuccess = useCallback(
    async (pdf: { numPages: number; getPage: (n: number) => Promise<any> }) => {
      setNumPages(pdf.numPages);
      if (summary || summarizing) return;
      setSummarizing(true);
      try {
        let full = '';
        const max = Math.min(pdf.numPages, 80);
        for (let i = 1; i <= max; i++) {
          const page = await pdf.getPage(i);
          const tc = await page.getTextContent();
          const pageText = tc.items
            .map((it: any) => ('str' in it ? it.str : ''))
            .join(' ');
          full += pageText + '\n\n';
          if (full.length > 120000) break;
        }
        const { summary: s } = await summarizeDoc(full);
        setSummary(s);
      } catch (err) {
        console.error('summarize failed', err);
      } finally {
        setSummarizing(false);
      }
    },
    [summary, summarizing, setSummary, setSummarizing]
  );

  const addHighlight = useDocumentStore((s) => s.addHighlight);

  const recordHighlight = useCallback(
    (frameId: string) => {
      if (!selection) return;
      if (
        selection.pdfPageIndex == null ||
        !selection.pdfPageRects ||
        selection.pdfPageRects.length === 0 ||
        !selection.pdfCaptureScale
      )
        return;
      addHighlight({
        id: crypto.randomUUID(),
        frameId,
        pageIndex: selection.pdfPageIndex,
        captureScale: selection.pdfCaptureScale,
        rects: selection.pdfPageRects,
        text: selection.text,
      });
    },
    [selection, addHighlight]
  );

  const handleAsk = useCallback(
    (question: string) => {
      if (!selection) return;
      const id = startLesson({
        sourceText: selection.text,
        question,
        docSummary: summary,
      });
      recordHighlight(id);
      clear();
    },
    [selection, clear, summary, recordHighlight]
  );

  const handleVideo = useCallback(
    (question: string) => {
      if (!selection) return;
      const id = startVideoDirect({
        sourceText: selection.text,
        question,
        docSummary: summary,
      });
      recordHighlight(id);
      clear();
    },
    [selection, clear, summary, recordHighlight]
  );

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-auto bg-[#07070a]">
      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-neutral-800/80 bg-[#0a0a0d]/90 px-4 py-2.5 backdrop-blur-md">
        <label className="group cursor-pointer rounded-md border border-neutral-800 bg-[#111114] px-3 py-1.5 text-[11px] font-medium text-neutral-300 transition hover:border-indigo-500/40 hover:bg-[#15151b] hover:text-neutral-100">
          <span className="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5-5 5 5M12 5v12" />
            </svg>
            {doc ? 'Replace PDF' : 'Upload PDF'}
          </span>
          <input type="file" accept="application/pdf" onChange={onFile} className="hidden" />
        </label>
        {doc && (
          <span className="truncate font-mono text-[11px] text-neutral-500">{doc.filename}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {doc && (
            <div className="flex items-center gap-1 rounded-md border border-neutral-800 bg-[#111114] p-0.5 mr-2">
              <button onClick={() => setScale(s => Math.max(0.5, s - 0.2))} className="px-2 py-0.5 text-neutral-400 hover:text-neutral-100">-</button>
              <span className="text-[10px] font-mono w-8 text-center text-neutral-300">{Math.round(scale * 100)}%</span>
              <button onClick={() => setScale(s => Math.min(3, s + 0.2))} className="px-2 py-0.5 text-neutral-400 hover:text-neutral-100">+</button>
            </div>
          )}
          {summarizing ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-800 bg-[#111114] px-2 py-0.5 text-[10px] font-medium text-neutral-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
              Indexing
            </span>
          ) : summary ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Indexed
            </span>
          ) : null}
        </div>
      </div>

      <div className="p-6 flex flex-col items-center">
        {doc ? (
          <Document
            file={doc.file}
            onLoadSuccess={onLoadSuccess}
            loading={<div className="text-neutral-500">Loading PDF…</div>}
            error={<div className="text-rose-400">Failed to load PDF.</div>}
          >
            {Array.from({ length: numPages }, (_, i) => (
              <div
                key={i}
                className="relative mb-6 overflow-hidden rounded-lg bg-white shadow-[0_8px_30px_-8px_rgba(0,0,0,0.6)] ring-1 ring-neutral-800"
              >
                <Page
                  pageNumber={i + 1}
                  width={680 * scale}
                  renderTextLayer
                  renderAnnotationLayer={false}
                />
                <HighlightOverlays pageIndex={i} renderedWidth={680 * scale} />
              </div>
            ))}
          </Document>
        ) : (
          <EmptyPdf />
        )}
      </div>

      {selection && (
        <SelectionPopover
          x={selection.rect.x}
          y={selection.rect.y}
          text={selection.text}
          onAsk={handleAsk}
          onVideo={handleVideo}
          onDismiss={clear}
        />
      )}
    </div>
  );
}

function EmptyPdf() {
  return (
    <div className="flex h-[70vh] items-center justify-center">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-neutral-800 bg-[#111114]">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#a3a3a3" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6M9 13h6M9 17h6" />
          </svg>
          <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 ring-4 ring-[#07070a]">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </div>
        </div>
        <div>
          <div className="text-sm font-medium text-neutral-200">Upload a PDF to begin</div>
          <div className="mt-1 text-xs leading-relaxed text-neutral-500">
            Highlight any text, then press <kbd className="rounded border border-neutral-700 bg-[#15151b] px-1 font-mono text-[10px] text-neutral-300">Enter</kbd> for an explanation, or <kbd className="rounded border border-neutral-700 bg-[#15151b] px-1 font-mono text-[10px] text-neutral-300">⌘ Enter</kbd> for an animation.
          </div>
        </div>
      </div>
    </div>
  );
}
