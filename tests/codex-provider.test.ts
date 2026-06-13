import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  discoverCodexSessions,
  deleteCodexSession,
} from '../src/server/providers/codex.js';

// A minimal valid Codex JSONL
const SAMPLE_CODEX_JSONL = [
  '{"timestamp":"2026-06-04T05:38:46.641Z","type":"session_meta","payload":{"id":"019e9124-2875-72f2-bda8-2060565c8e68","timestamp":"2026-06-04T05:38:46.517Z","cwd":"/home/user/project","source":"vscode","cli_version":"0.133.0"}}',
  '{"timestamp":"2026-06-04T05:38:46.652Z","type":"event_msg","payload":{"type":"task_started"}}',
  '{"timestamp":"2026-06-04T05:39:02.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Fix the login bug"}]}}',
  '{"timestamp":"2026-06-04T05:39:10.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"I will fix it now."}]}}',
].join('\n') + '\n';

// A subagent session (session_meta with source.subagent = true)
const SUBAGENT_CODEX_JSONL = [
  '{"timestamp":"2026-06-04T06:00:00.000Z","type":"session_meta","payload":{"id":"subagent-session-xyz","timestamp":"2026-06-04T06:00:00.000Z","cwd":"/home/user/project","source":{"subagent":true},"cli_version":"0.133.0"}}',
  '{"timestamp":"2026-06-04T06:00:01.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Subagent task"}]}}',
].join('\n') + '\n';

let tmpDir: string;
let codexConfigDir: string;
let sessionDir: string;
let sessionFile: string;
let subagentFile: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-provider-test-'));
  codexConfigDir = tmpDir;

  // Mimic ~/.codex/sessions/2026/06/04/ structure
  sessionDir = path.join(codexConfigDir, 'sessions', '2026', '06', '04');
  await fs.mkdir(sessionDir, { recursive: true });

  // Normal session
  sessionFile = path.join(sessionDir, '019e9124-session.jsonl');
  await fs.writeFile(sessionFile, SAMPLE_CODEX_JSONL, 'utf-8');

  // Subagent session (should be skipped)
  subagentFile = path.join(sessionDir, 'subagent-session-xyz.jsonl');
  await fs.writeFile(subagentFile, SUBAGENT_CODEX_JSONL, 'utf-8');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('discoverCodexSessions', () => {
  it('finds sessions and skips subagent sessions', async () => {
    const sessions = await discoverCodexSessions(codexConfigDir);
    expect(sessions.length).toBe(1);
    expect(sessions[0].filePath).toBe(sessionFile);
    expect(sessions[0].provider).toBe('codex');
    expect(sessions[0].id).toBe('019e9124-2875-72f2-bda8-2060565c8e68');
    expect(sessions[0].title).toBe('Fix the login bug');
    expect(sessions[0].cwd).toBe('/home/user/project');
  });

  it('returns sessions sorted by lastActivity descending', async () => {
    // Create a second session with a later timestamp
    const session2Dir = path.join(codexConfigDir, 'sessions', '2026', '06', '05');
    await fs.mkdir(session2Dir, { recursive: true });
    const laterJsonl = [
      '{"timestamp":"2026-06-05T10:00:00.000Z","type":"session_meta","payload":{"id":"newer-session-abc","timestamp":"2026-06-05T10:00:00.000Z","cwd":"/home/user/project2","source":"vscode","cli_version":"0.133.0"}}',
      '{"timestamp":"2026-06-05T10:00:01.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Newer task"}]}}',
    ].join('\n') + '\n';
    const session2File = path.join(session2Dir, 'newer-session-abc.jsonl');
    await fs.writeFile(session2File, laterJsonl, 'utf-8');

    const sessions = await discoverCodexSessions(codexConfigDir);
    expect(sessions.length).toBe(2);
    // Most recent first
    expect(sessions[0].filePath).toBe(session2File);
    expect(sessions[1].filePath).toBe(sessionFile);
  });

  it('returns empty array when sessions directory does not exist', async () => {
    const emptyConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-empty-'));
    try {
      const sessions = await discoverCodexSessions(emptyConfigDir);
      expect(sessions).toEqual([]);
    } finally {
      await fs.rm(emptyConfigDir, { recursive: true, force: true });
    }
  });

  it('also scans archived_sessions directory', async () => {
    // Create an archived session
    const archivedDir = path.join(codexConfigDir, 'archived_sessions', '2026', '05', '01');
    await fs.mkdir(archivedDir, { recursive: true });
    const archivedJsonl = [
      '{"timestamp":"2026-05-01T08:00:00.000Z","type":"session_meta","payload":{"id":"archived-session-111","timestamp":"2026-05-01T08:00:00.000Z","cwd":"/home/user/old","source":"vscode","cli_version":"0.133.0"}}',
      '{"timestamp":"2026-05-01T08:00:01.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Old archived task"}]}}',
    ].join('\n') + '\n';
    const archivedFile = path.join(archivedDir, 'archived-session-111.jsonl');
    await fs.writeFile(archivedFile, archivedJsonl, 'utf-8');

    const sessions = await discoverCodexSessions(codexConfigDir);
    expect(sessions.length).toBe(2); // 1 normal + 1 archived (subagent skipped)
    const archivedSession = sessions.find(s => s.filePath === archivedFile);
    expect(archivedSession).toBeDefined();
    expect(archivedSession?.id).toBe('archived-session-111');
  });
});

describe('deleteCodexSession', () => {
  it('deletes the JSONL file', async () => {
    await deleteCodexSession(sessionFile, codexConfigDir);

    // File should be gone
    await expect(fs.access(sessionFile)).rejects.toThrow();
  });

  it('rejects paths outside the config dir', async () => {
    const outsidePath = '/tmp/evil.jsonl';
    await expect(deleteCodexSession(outsidePath, codexConfigDir)).rejects.toThrow();
  });
});
