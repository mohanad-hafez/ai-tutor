import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PdfDoc } from '../types';

export interface PdfHighlight {
  id: string;
  frameId: string;
  pageIndex: number;
  captureScale: number;
  rects: { x: number; y: number; w: number; h: number }[];
  text: string;
}

interface DocState {
  doc: PdfDoc | null;
  summary: string | null;
  summarizing: boolean;
  docId: string | null;
  chunkCount: number;
  highlights: PdfHighlight[];
  setDoc: (doc: PdfDoc | null) => void;
  setSummary: (s: string | null) => void;
  setSummarizing: (v: boolean) => void;
  setDocId: (docId: string | null, chunkCount?: number) => void;
  addHighlight: (h: PdfHighlight) => void;
  removeHighlight: (id: string) => void;
  clearHighlights: () => void;
}

export const useDocumentStore = create<DocState>()(
  persist(
    (set) => ({
      doc: null,
      summary: null,
      summarizing: false,
      docId: null,
      chunkCount: 0,
      highlights: [],
      setDoc: (doc) => set({ doc, summary: null, summarizing: false, docId: null, chunkCount: 0 }),
      setSummary: (summary) => set({ summary }),
      setSummarizing: (summarizing) => set({ summarizing }),
      setDocId: (docId, chunkCount = 0) => set({ docId, chunkCount }),
      addHighlight: (h) => set((s) => ({ highlights: [...s.highlights, h] })),
      removeHighlight: (id) => set((s) => ({ highlights: s.highlights.filter((h) => h.id !== id) })),
      clearHighlights: () => set({ highlights: [] }),
    }),
    {
      name: 'ai-tutor-document',
      partialize: (s) => ({ highlights: s.highlights }),
    }
  )
);
