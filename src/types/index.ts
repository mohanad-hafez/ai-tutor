export type FrameType = 'root' | 'child' | 'quiz' | 'remediation' | 'summary';

export interface FrameContent {
  html?: string;
  css?: string;
  js?: string;
}

export interface FrameData {
  id: string;
  type: FrameType;
  title: string;
  summary: string;
  content?: FrameContent;
  sourceText?: string;
  sourceLoc?: { page?: number; offset?: number };
  parentIds: string[];
  childIds: string[];
  loading?: boolean;
}

export interface PdfDoc {
  id: string;
  filename: string;
  file: File;
  numPages: number;
}

export interface SelectionInfo {
  text: string;
  rect: { x: number; y: number; w: number; h: number };
  page?: number;
  context?: string;
}
