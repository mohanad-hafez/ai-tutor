import { useMemo } from 'react';
import { useDocumentStore } from '../../store/documentStore';
import { useGraphStore } from '../../store/graphStore';

interface Props {
  pageIndex: number;
  renderedWidth: number;
}

export function HighlightOverlays({ pageIndex, renderedWidth }: Props) {
  const highlights = useDocumentStore((s) => s.highlights);
  const removeHighlight = useDocumentStore((s) => s.removeHighlight);
  const setFocused = useGraphStore((s) => s.setFocused);
  const nodes = useGraphStore((s) => s.nodes);

  const onPage = useMemo(
    () => highlights.filter((h) => h.pageIndex === pageIndex),
    [highlights, pageIndex]
  );

  if (!onPage.length) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {onPage.map((h) => {
        const factor = h.captureScale > 0 ? renderedWidth / h.captureScale : 1;
        const node = nodes.find((n) => n.id === h.frameId);
        const title = node?.data.title || 'Lesson';
        return h.rects.map((r, i) => (
          <button
            key={`${h.id}-${i}`}
            onClick={() => {
              if (node) setFocused(h.frameId);
              else removeHighlight(h.id);
            }}
            title={node ? `${title} — click to open` : 'Lesson removed — click to clean up'}
            style={{
              position: 'absolute',
              left: r.x * factor,
              top: r.y * factor,
              width: r.w * factor,
              height: r.h * factor,
            }}
            className="pointer-events-auto cursor-pointer rounded-[2px] bg-indigo-500/30 ring-1 ring-indigo-400/40 transition hover:bg-indigo-500/50 hover:ring-indigo-300"
          />
        ));
      })}
    </div>
  );
}
