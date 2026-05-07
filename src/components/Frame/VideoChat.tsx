import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, FrameData } from '../../types';
import { useGraphStore } from '../../store/graphStore';
import { useDocumentStore } from '../../store/documentStore';
import { chatStream } from '../../agent/tutor';
import { startLesson } from '../../lib/lessonFlow';

interface Props { data: FrameData }

export function VideoChat({ data }: Props) {
  const appendChatMessage = useGraphStore((s) => s.appendChatMessage);
  const patchChatMessage = useGraphStore((s) => s.patchChatMessage);
  const docSummary = useDocumentStore((s) => s.summary);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const messages = data.chat ?? [];

  // Auto-scroll to the bottom when new content arrives.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, messages[messages.length - 1]?.text]);

  const replyHere = () => {
    const q = draft.trim();
    if (!q || busy) return;
    setBusy(true);
    setDraft('');
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: q,
    };
    appendChatMessage(data.id, userMsg);

    const assistantId = crypto.randomUUID();
    appendChatMessage(data.id, {
      id: assistantId,
      role: 'assistant',
      text: '',
      streaming: true,
    });

    const recent = (data.chat ?? []).slice(-6).map((m) => ({ role: m.role, text: m.text }));
    chatStream(
      {
        contextTitle: data.title,
        contextSummary: data.summary,
        videoChapters: data.content?.videoChapters,
        docSummary: docSummary ?? undefined,
        history: recent,
        question: q,
      },
      {
        onDelta: (delta) => {
          // Read the latest text from the store to avoid clobbering parallel updates
          const cur = useGraphStore.getState().nodes.find((n) => n.id === data.id)?.data.chat?.find((m) => m.id === assistantId);
          patchChatMessage(data.id, assistantId, { text: (cur?.text ?? '') + delta });
        },
        onDone: () => {
          patchChatMessage(data.id, assistantId, { streaming: false });
          setBusy(false);
        },
        onError: (msg) => {
          patchChatMessage(data.id, assistantId, {
            streaming: false,
            text: `_Error: ${msg}_`,
          });
          setBusy(false);
        },
      }
    );
  };

  const newNode = () => {
    const q = draft.trim();
    if (!q || busy) return;
    setDraft('');
    startLesson({
      sourceText: q,
      question: q,
      docSummary,
      parentId: data.id,
      parentTitle: data.title,
    });
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      newNode();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      replyHere();
    }
  };

  return (
    <div className="flex flex-col border-t border-neutral-800/80 bg-[#0a0a0d]">
      {messages.length > 0 && (
        <div
          ref={scrollRef}
          className="max-h-[280px] overflow-y-auto border-b border-neutral-800/50 px-4 py-3"
        >
          <div className="flex flex-col gap-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[88%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed ${
                    m.role === 'user'
                      ? 'rounded-tr-sm bg-indigo-500/15 text-indigo-100 ring-1 ring-indigo-500/25'
                      : 'rounded-tl-sm bg-[#15151b] text-neutral-200 ring-1 ring-neutral-800'
                  }`}
                >
                  <div className="whitespace-pre-wrap">{m.text}</div>
                  {m.streaming && (
                    <span className="ml-1 inline-block h-3 w-1.5 translate-y-[1px] animate-pulse rounded-sm bg-indigo-400" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 px-4 py-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          rows={2}
          placeholder="Ask about the animation… (Enter to reply here · ⌘ Enter to spawn a new node)"
          className="resize-none rounded-md border border-neutral-800 bg-[#0d0d11] px-3 py-2 text-[13px] text-neutral-100 placeholder:text-neutral-500 outline-none transition focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/15"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-500">
            {messages.length > 0 ? `${messages.filter((m) => m.role === 'user').length} message(s)` : 'follow up'}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={newNode}
              disabled={!draft.trim() || busy}
              title="Spawn this question as a new lesson frame (⌘ Enter)"
              className="flex items-center gap-1.5 rounded-md border border-neutral-800 bg-[#0d0d11] px-3 py-1.5 text-[11px] font-medium text-neutral-300 transition hover:border-indigo-500/40 hover:text-indigo-300 disabled:opacity-40 disabled:hover:border-neutral-800 disabled:hover:text-neutral-300"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 8l8 8"/>
              </svg>
              New node
            </button>
            <button
              onClick={replyHere}
              disabled={!draft.trim() || busy}
              title="Answer here in the chat (Enter)"
              className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-[11px] font-medium text-white shadow-[0_4px_14px_-4px_rgba(99,102,241,0.6)] transition hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600"
            >
              {busy ? 'Thinking…' : 'Reply here'}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 5l7 7-7 7"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
