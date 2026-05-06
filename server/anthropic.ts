import Anthropic from '@anthropic-ai/sdk';

export const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const MAIN_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
export const FAST_MODEL = process.env.ANTHROPIC_FAST_MODEL || 'claude-haiku-4-5';
export const SUMMARY_MODEL = process.env.ANTHROPIC_SUMMARY_MODEL || FAST_MODEL;
export const QUIZ_MODEL = process.env.ANTHROPIC_QUIZ_MODEL || FAST_MODEL;

export function extractText(completion: Anthropic.Messages.Message): string {
  for (const block of completion.content) {
    if (block.type === 'text') return block.text;
  }
  return '';
}

export function findToolUse<T = unknown>(
  completion: Anthropic.Messages.Message,
  name: string
): T | null {
  for (const block of completion.content) {
    if (block.type === 'tool_use' && block.name === name) {
      return block.input as T;
    }
  }
  return null;
}

export function parseJsonRelaxed<T = unknown>(raw: string): T {
  const cleaned = raw
    .replace(/```json\n?|```/g, '')
    .replace(/^[^{[]*/, '')
    .trim();
  return JSON.parse(cleaned) as T;
}
