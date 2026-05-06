import { useEffect, useState } from 'react';
import type { SelectionInfo } from '../../types';

function findPdfPage(node: Node | null): HTMLElement | null {
  let cur: Node | null = node;
  while (cur && cur.nodeType !== 1) cur = cur.parentNode;
  let el = cur as HTMLElement | null;
  while (el && !(el.classList && el.classList.contains('react-pdf__Page'))) {
    el = el.parentElement;
  }
  return el;
}

export function useTextSelection(containerRef: React.RefObject<HTMLElement | null>) {
  const [selection, setSelection] = useState<SelectionInfo | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const commit = () => {
      const active = document.activeElement;
      if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
        return;
      }
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        setSelection(null);
        return;
      }
      const text = sel.toString().trim();
      if (!text) {
        setSelection(null);
        return;
      }
      const range = sel.getRangeAt(0);
      if (!el.contains(range.commonAncestorContainer)) {
        setSelection(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      const containerRect = el.getBoundingClientRect();
      const containerWidth = containerRect.width;
      const xPos = rect.left + rect.width / 2 - containerRect.left + el.scrollLeft - 190;
      const safeX = Math.max(el.scrollLeft + 10, Math.min(xPos, el.scrollLeft + containerWidth - 390));

      // Capture page-local rects so we can persist a stable highlight overlay.
      let pdfPageIndex: number | undefined;
      let pdfPageRects: { x: number; y: number; w: number; h: number }[] | undefined;
      let pdfCaptureScale: number | undefined;
      const pageEl = findPdfPage(range.startContainer);
      if (pageEl) {
        const pageNum = Number(pageEl.dataset.pageNumber || pageEl.getAttribute('data-page-number') || NaN);
        if (Number.isFinite(pageNum)) pdfPageIndex = pageNum - 1;
        const pageRect = pageEl.getBoundingClientRect();
        const list = Array.from(range.getClientRects()).filter((r) => r.width > 1 && r.height > 1);
        pdfPageRects = list.map((r) => ({
          x: r.left - pageRect.left,
          y: r.top - pageRect.top,
          w: r.width,
          h: r.height,
        }));
        pdfCaptureScale = pageRect.width;
      }

      setSelection({
        text,
        rect: {
          x: safeX,
          y: rect.top - containerRect.top + el.scrollTop,
          w: rect.width,
          h: rect.height,
        },
        pdfPageIndex,
        pdfPageRects,
        pdfCaptureScale,
      });
    };

    const onUp = () => setTimeout(commit, 0);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('keyup', onUp);
    return () => {
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keyup', onUp);
    };
  }, [containerRef]);

  const clear = () => {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  };

  return { selection, clear };
}
