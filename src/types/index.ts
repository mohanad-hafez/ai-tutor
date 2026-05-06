export type FrameType = 'root' | 'child' | 'quiz' | 'remediation' | 'summary' | 'video';

export type LessonMode = 'text' | 'visual_html' | 'video_manim';

export type VideoStage =
  | 'queued'
  | 'planning'
  | 'generating'
  | 'rendering'
  | 'done'
  | 'error';

export interface VideoChapter {
  t: number;
  label: string;
}

export interface LessonPrereq {
  title: string;
  brief: string;
}

export interface FrameContent {
  html?: string;
  css?: string;
  js?: string;
  videoUrl?: string;
  videoDurationSec?: number;
  videoChapters?: VideoChapter[];
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
  mode?: LessonMode;
  videoJobId?: string;
  videoStage?: VideoStage;
  videoProgress?: number;
  videoMessage?: string;
  videoEtaSec?: number;
  videoError?: string;
  prerequisites?: LessonPrereq[];
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
  pdfPageIndex?: number;
  pdfPageRects?: { x: number; y: number; w: number; h: number }[];
  pdfCaptureScale?: number;
}
