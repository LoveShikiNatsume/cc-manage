import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  discoverClaudeSessions,
  deleteClaudeSession,
  renameClaudeSession,
} from '../src/server/providers/claude.js';

// A minimal valid Claude JSONL with queue-operation, user message, cwd, and a timestamp
const SAMPLE_JSONL = [
  '{"type":"queue-operation","operation":"enqueue","timestamp":"2026-06-01T02:40:05.900Z","sessionId":"test-session-001"}',
  '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Help me refactor the auth module"}]},"cwd":"/home/user/myproject","timestamp":"2026-06-01T02:40:06.000Z","sessionId":"test-session-001"}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Sure!"}]},"timestamp":"2026-06-01T02:41:00.000Z"}',
].join('\n') + '\n';

let tmpDir: string;
let claudeConfigDir: string;
let projectDir: string;
let sessionFile: string;
let sidecarDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-provider-test-'));
  // Mimic ~/.claude/projects/<project>/
  claudeConfigDir = tmpDir;
  projectDir = path.join(claudeConfigDir, 'projects', 'myproject');
  await fs.mkdir(projectDir, { recursive: true });

  // Create a normal session JSONL
  sessionFile = path.join(projectDir, 'test-session-001.jsonl');
  await fs.writeFile(sessionFile, SAMPLE_JSONL, 'utf-8');

  // Create corresponding sidecar directory (same name without .jsonl)
  sidecarDir = path.join(projectDir, 'test-session-001');
  await fs.mkdir(sidecarDir, { recursive: true });
  await fs.writeFile(path.join(sidecarDir, 'some-artifact.txt'), 'artifact content');

  // Create an agent- prefixed file (should be skipped)
  await fs.writeFile(
    path.join(projectDir, 'agent-subagent-abc.jsonl'),
    SAMPLE_JSONL,
    'utf-8',
  );
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('discoverClaudeSessions', () => {
  it('finds JSONL sessions and skips agent- prefixed files', async () => {
    const sessions = await discoverClaudeSessions(claudeConfigDir);
    expect(sessions.length).toBe(1);
    expect(sessions[0].filePath).toBe(sessionFile);
    expect(sessions[0].provider).toBe('claude');
    expect(sessions[0].id).toBe('test-session-001');
    expect(sessions[0].title).toBe('Help me refactor the auth module');
    expect(sessions[0].project).toBe('myproject');
  });

  it('returns sessions sorted by lastActivity descending', async () => {
    // Create a second session with a later timestamp
    const session2File = path.join(projectDir, 'test-session-002.jsonl');
    const laterJsonl = [
      '{"type":"queue-operation","operation":"enqueue","timestamp":"2026-06-02T10:00:00.000Z","sessionId":"test-session-002"}',
      '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Newer session"}]},"cwd":"/home/user/myproject","timestamp":"2026-06-02T10:00:01.000Z","sessionId":"test-session-002"}',
    ].join('\n') + '\n';
    await fs.writeFile(session2File, laterJsonl, 'utf-8');

    const sessions = await discoverClaudeSessions(claudeConfigDir);
    expect(sessions.length).toBe(2);
    // Most recent first
    expect(sessions[0].filePath).toBe(session2File);
    expect(sessions[1].filePath).toBe(sessionFile);
  });

  it('returns empty array when projects directory does not exist', async () => {
    const emptyConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-empty-'));
    try {
      const sessions = await discoverClaudeSessions(emptyConfigDir);
      expect(sessions).toEqual([]);
    } finally {
      await fs.rm(emptyConfigDir, { recursive: true, force: true });
    }
  });
});

describe('deleteClaudeSession', () => {
  it('deletes the JSONL file and its sidecar directory', async () => {
    await deleteClaudeSession(sessionFile, claudeConfigDir);

    // JSONL file should be gone
    await expect(fs.access(sessionFile)).rejects.toThrow();
    // Sidecar directory should also be gone
    await expect(fs.access(sidecarDir)).rejects.toThrow();
  });

  it('succeeds even when sidecar directory does not exist', async () => {
    // Remove the sidecar dir first
    await fs.rm(sidecarDir, { recursive: true, force: true });

    // Should not throw
    await expect(deleteClaudeSession(sessionFile, claudeConfigDir)).resolves.toBeUndefined();
    await expect(fs.access(sessionFile)).rejects.toThrow();
  });

  it('rejects paths outside the config dir', async () => {
    const outsidePath = '/tmp/evil.jsonl';
    await expect(deleteClaudeSession(outsidePath, claudeConfigDir)).rejects.toThrow();
  });
});

describe('renameClaudeSession', () => {
  it('appends a custom-title entry to the JSONL file', async () => {
    await renameClaudeSession(sessionFile, 'My New Title', claudeConfigDir);

    const content = await fs.readFile(sessionFile, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    const lastLine = lines[lines.length - 1];
    const parsed = JSON.parse(lastLine);

    expect(parsed.type).toBe('custom-title');
    expect(parsed.customTitle).toBe('My New Title');
    expect(parsed.sessionId).toBe('test-session-001');
    expect(typeof parsed.timestamp).toBe('string');
  });

  it('makes re-discovered session show the new title', async () => {
    await renameClaudeSession(sessionFile, 'Renamed Session Title', claudeConfigDir);

    const sessions = await discoverClaudeSessions(claudeConfigDir);
    const session = sessions.find(s => s.filePath === sessionFile);
    expect(session?.title).toBe('Renamed Session Title');
  });

  it('rejects paths outside the config dir', async () => {
    const outsidePath = '/tmp/evil.jsonl';
    await expect(renameClaudeSession(outsidePath, 'title', claudeConfigDir)).rejects.toThrow();
  });
});
