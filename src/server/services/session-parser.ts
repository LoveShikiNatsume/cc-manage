import fs from 'fs/promises';
import type { SessionMeta, SessionMessage } from '@shared/types.js';

const HEAD_LINES = 10;
const TAIL_LINES = 30;
const SMALL_FILE_THRESHOLD = 16 * 1024;
const TAIL_BUFFER_SIZE = 16 * 1024;
const TITLE_MAX_CHARS = 80;

export interface HeadTailResult {
  headLines: string[];
  tailLines: string[];
}

export async function readHeadTail(filePath: string): Promise<HeadTailResult> {
  const stat = await fs.stat(filePath);

  if (stat.size <= SMALL_FILE_THRESHOLD) {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    return {
      headLines: lines.slice(0, HEAD_LINES),
      tailLines: lines.slice(-TAIL_LINES),
    };
  }

  const fd = await fs.open(filePath, 'r');
  try {
    const headBuf = Buffer.alloc(TAIL_BUFFER_SIZE);
    const { bytesRead: headBytes } = await fd.read(headBuf, 0, TAIL_BUFFER_SIZE, 0);
    const headLines = headBuf
      .subarray(0, headBytes)
      .toString('utf-8')
      .split('\n')
      .filter(l => l.trim())
      .slice(0, HEAD_LINES);

    const tailOffset = Math.max(0, stat.size - TAIL_BUFFER_SIZE);
    const tailBuf = Buffer.alloc(Math.min(TAIL_BUFFER_SIZE, stat.size));
    const { bytesRead: tailBytes } = await fd.read(tailBuf, 0, tailBuf.length, tailOffset);
    const allTailLines = tailBuf
      .subarray(0, tailBytes)
      .toString('utf-8')
      .split('\n')
      .filter(l => l.trim());
    const tailLines =
      tailOffset > 0
        ? allTailLines.slice(1).slice(-TAIL_LINES)
        : allTailLines.slice(-TAIL_LINES);

    return { headLines, tailLines };
  } finally {
    await fd.close();
  }
}

function safeParseJSON(line: string): any | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function extractTextContent(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (
        (block.type === 'text' ||
          block.type === 'input_text' ||
          block.type === 'output_text') &&
        block.text
      ) {
        return block.text;
      }
    }
  }
  return null;
}

function extractTimestamp(obj: any): number | null {
  const ts = obj.timestamp ?? obj.message?.timestamp;
  if (!ts) return null;
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') return new Date(ts).getTime();
  return null;
}

// --- Claude ---

export function extractClaudeSessionMeta(
  headLines: string[],
  tailLines: string[],
  filePath: string,
): SessionMeta {
  let id = '';
  let title = '';
  let cwd = '';
  let lastActivity = 0;

  for (const line of headLines) {
    const obj = safeParseJSON(line);
    if (!obj) continue;

    if (obj.type === 'queue-operation' && obj.sessionId && !id) {
      id = obj.sessionId;
    }

    if (obj.type === 'user' && obj.message?.content && !title) {
      const text = extractTextContent(obj.message.content);
      if (text) title = text.slice(0, TITLE_MAX_CHARS);
    }

    if (obj.cwd && !cwd) cwd = obj.cwd;

    const ts = extractTimestamp(obj);
    if (ts && ts > lastActivity) lastActivity = ts;
  }

  for (let i = tailLines.length - 1; i >= 0; i--) {
    const obj = safeParseJSON(tailLines[i]);
    if (!obj) continue;

    if (obj.type === 'custom-title' && obj.title) {
      title = obj.title.slice(0, TITLE_MAX_CHARS);
    }

    const ts = extractTimestamp(obj);
    if (ts && ts > lastActivity) lastActivity = ts;
  }

  const project = cwd ? cwd.split('/').pop() || cwd : 'unknown';

  return {
    id: id || filePath.split('/').pop()?.replace('.jsonl', '') || 'unknown',
    provider: 'claude',
    title: title || 'Untitled',
    project,
    cwd,
    lastActivity,
    filePath,
  };
}

export async function parseClaudeMessages(filePath: string): Promise<SessionMessage[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  const messages: SessionMessage[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    const obj = safeParseJSON(line);
    if (!obj) continue;

    if ((obj.type === 'user' || obj.type === 'assistant') && obj.message?.content) {
      const text = extractTextContent(obj.message.content);
      if (text) {
        messages.push({
          role: obj.message.role || obj.type,
          content: text,
          timestamp: extractTimestamp(obj) || 0,
        });
      }
    }
  }

  return messages;
}

// --- Codex ---

function isCodexSystemContent(text: string): boolean {
  return (
    text.startsWith('# AGENTS.md') ||
    text.startsWith('<permissions') ||
    text.startsWith('<environment_context')
  );
}

function extractCodexUserPrompt(text: string): string | null {
  if (isCodexSystemContent(text)) return null;

  const marker = '## My request for Codex:';
  const idx = text.indexOf(marker);
  if (idx !== -1) {
    return text.slice(idx + marker.length).trim();
  }

  return text.trim();
}

export function extractCodexSessionMeta(
  headLines: string[],
  tailLines: string[],
  filePath: string,
): SessionMeta {
  let id = '';
  let cwd = '';
  let title = '';
  let lastActivity = 0;

  for (const line of headLines) {
    const obj = safeParseJSON(line);
    if (!obj) continue;

    if (obj.type === 'session_meta' && obj.payload) {
      if (obj.payload.id && !id) id = obj.payload.id;
      if (obj.payload.cwd && !cwd) cwd = obj.payload.cwd;
    }

    if (
      obj.type === 'response_item' &&
      obj.payload?.role === 'user' &&
      obj.payload?.content &&
      !title
    ) {
      const text = extractTextContent(obj.payload.content);
      if (text) {
        const prompt = extractCodexUserPrompt(text);
        if (prompt) title = prompt.slice(0, TITLE_MAX_CHARS);
      }
    }

    const ts = obj.timestamp ? new Date(obj.timestamp).getTime() : null;
    if (ts && ts > lastActivity) lastActivity = ts;
  }

  for (let i = tailLines.length - 1; i >= 0; i--) {
    const obj = safeParseJSON(tailLines[i]);
    if (!obj) continue;
    const ts = obj.timestamp ? new Date(obj.timestamp).getTime() : null;
    if (ts && ts > lastActivity) lastActivity = ts;
  }

  const project = cwd ? cwd.split('/').pop() || cwd : 'unknown';

  return {
    id: id || filePath.split('/').pop()?.replace('.jsonl', '') || 'unknown',
    provider: 'codex',
    title: title || 'Untitled',
    project,
    cwd,
    lastActivity,
    filePath,
  };
}

export async function parseCodexMessages(filePath: string): Promise<SessionMessage[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  const messages: SessionMessage[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    const obj = safeParseJSON(line);
    if (!obj || obj.type !== 'response_item' || !obj.payload) continue;

    const role = obj.payload.role;
    if (role === 'developer') continue;

    const text = extractTextContent(obj.payload.content);
    if (!text) continue;

    if (role === 'user' && isCodexSystemContent(text)) continue;

    let cleanText = text;
    if (role === 'user') {
      const prompt = extractCodexUserPrompt(text);
      if (!prompt) continue;
      cleanText = prompt;
    }

    messages.push({
      role: role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : 'system',
      content: cleanText,
      timestamp: obj.timestamp ? new Date(obj.timestamp).getTime() : 0,
    });
  }

  return messages;
}
