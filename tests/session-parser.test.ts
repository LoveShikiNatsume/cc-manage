import { describe, it, expect } from 'vitest';
import path from 'path';
import {
  readHeadTail,
  extractClaudeSessionMeta,
  extractCodexSessionMeta,
  parseClaudeMessages,
  parseCodexMessages,
} from '../src/server/services/session-parser.js';

const FIXTURES = path.resolve(__dirname, 'fixtures');

describe('readHeadTail', () => {
  it('reads all lines from small files', async () => {
    const result = await readHeadTail(path.join(FIXTURES, 'claude-session.jsonl'));
    expect(result.headLines.length).toBeGreaterThan(0);
    expect(result.tailLines.length).toBeGreaterThan(0);
  });
});

describe('extractClaudeSessionMeta', () => {
  it('extracts session ID from queue-operation lines', () => {
    const headLines = [
      '{"type":"queue-operation","operation":"enqueue","timestamp":"2026-06-01T02:40:05.900Z","sessionId":"abc-123"}',
      '{"type":"queue-operation","operation":"dequeue","timestamp":"2026-06-01T02:40:05.915Z","sessionId":"abc-123"}',
      '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Hello world"}]},"cwd":"/home/user/proj","timestamp":"2026-06-01T02:40:06.000Z","sessionId":"abc-123"}',
    ];
    const meta = extractClaudeSessionMeta(headLines, [], '/path/to/file.jsonl');
    expect(meta.id).toBe('abc-123');
    expect(meta.title).toBe('Hello world');
    expect(meta.cwd).toBe('/home/user/proj');
  });

  it('prefers custom-title over first user message', () => {
    const headLines = [
      '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Original title"}]},"cwd":"/home/user/proj","timestamp":"2026-06-01T02:40:06.000Z","sessionId":"abc-123"}',
    ];
    const tailLines = [
      '{"type":"custom-title","title":"My Custom Title","timestamp":"2026-06-01T03:00:00.000Z"}',
    ];
    const meta = extractClaudeSessionMeta(headLines, tailLines, '/path/to/file.jsonl');
    expect(meta.title).toBe('My Custom Title');
  });

  it('extracts lastActivity from tail timestamps', () => {
    const headLines = [
      '{"type":"user","message":{"role":"user","content":"hi"},"cwd":"/proj","timestamp":"2026-06-01T02:40:00.000Z","sessionId":"abc"}',
    ];
    const tailLines = [
      '{"type":"assistant","message":{"role":"assistant","content":"bye"},"timestamp":"2026-06-01T03:00:00.000Z"}',
    ];
    const meta = extractClaudeSessionMeta(headLines, tailLines, '/path/file.jsonl');
    expect(meta.lastActivity).toBe(new Date('2026-06-01T03:00:00.000Z').getTime());
  });
});

describe('extractCodexSessionMeta', () => {
  it('extracts session ID and cwd from session_meta', () => {
    const headLines = [
      '{"timestamp":"2026-06-04T05:38:46.641Z","type":"session_meta","payload":{"id":"019e-uuid","cwd":"/home/user/project"}}',
      '{"timestamp":"2026-06-04T05:38:46.652Z","type":"event_msg","payload":{"type":"task_started"}}',
      '{"timestamp":"2026-06-04T05:39:01.618Z","type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"<permissions>stuff</permissions>"}]}}',
      '{"timestamp":"2026-06-04T05:39:01.618Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"# AGENTS.md instructions\\nstuff"}]}}',
      '{"timestamp":"2026-06-04T05:39:02.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Fix the login bug"}]}}',
    ];
    const meta = extractCodexSessionMeta(headLines, [], '/path/file.jsonl');
    expect(meta.id).toBe('019e-uuid');
    expect(meta.cwd).toBe('/home/user/project');
    expect(meta.title).toBe('Fix the login bug');
  });

  it('filters out AGENTS.md and permission messages for title', () => {
    const headLines = [
      '{"timestamp":"2026-06-04T05:38:46.641Z","type":"session_meta","payload":{"id":"019e","cwd":"/proj"}}',
      '{"timestamp":"2026-06-04T05:39:01.618Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"# AGENTS.md instructions for /proj\\nKeep clean."}]}}',
      '{"timestamp":"2026-06-04T05:39:02.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Implement dark mode"}]}}',
    ];
    const meta = extractCodexSessionMeta(headLines, [], '/path/file.jsonl');
    expect(meta.title).toBe('Implement dark mode');
  });

  it('extracts prompt from VS Code IDE context', () => {
    const headLines = [
      '{"timestamp":"2026-06-04T05:38:46.641Z","type":"session_meta","payload":{"id":"019e","cwd":"/proj"}}',
      '{"timestamp":"2026-06-04T05:39:02.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Some IDE context here\\n## My request for Codex:\\nPlease fix the tests"}]}}',
    ];
    const meta = extractCodexSessionMeta(headLines, [], '/path/file.jsonl');
    expect(meta.title).toBe('Please fix the tests');
  });
});

describe('parseClaudeMessages', () => {
  it('parses all user and assistant messages from JSONL', async () => {
    const filePath = path.join(FIXTURES, 'claude-session.jsonl');
    const messages = await parseClaudeMessages(filePath);
    expect(messages.length).toBe(4);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('Help me refactor the auth module');
    expect(messages[1].role).toBe('assistant');
    expect(messages[3].role).toBe('assistant');
  });
});

describe('parseCodexMessages', () => {
  it('parses user and assistant messages, skipping system entries', async () => {
    const filePath = path.join(FIXTURES, 'codex-session.jsonl');
    const messages = await parseCodexMessages(filePath);
    const roles = messages.map(m => m.role);
    expect(roles).not.toContain('system');
    expect(messages.some(m => m.role === 'user' && m.content.includes('Fix the login bug'))).toBe(true);
    expect(messages.some(m => m.role === 'assistant')).toBe(true);
  });
});
