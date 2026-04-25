import { create } from 'zustand';
import type { PdfDoc } from '../types';

interface DocState {
  doc: PdfDoc | null;
  summary: string | null;
  summarizing: boolean;
  setDoc: (doc: PdfDoc | null) => void;
  setSummary: (s: string | null) => void;
  setSummarizing: (v: boolean) => void;
}

export const useDocumentStore = create<DocState>((set) => ({
  doc: null,
  summary: null,
  summarizing: false,
  setDoc: (doc) => set({ doc, summary: null, summarizing: false }),
  setSummary: (summary) => set({ summary }),
  setSummarizing: (summarizing) => set({ summarizing }),
}));
