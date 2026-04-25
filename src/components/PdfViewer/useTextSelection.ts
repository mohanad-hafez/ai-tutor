import { useEffect, useState } from 'react';
import type { SelectionInfo } from '../../types';

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

      setSelection({
        text,
        rect: {
          x: safeX,
          y: rect.top - containerRect.top + el.scrollTop,
          w: rect.width,
          h: rect.height,
        },
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
