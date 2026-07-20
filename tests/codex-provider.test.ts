import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import {
  discoverCodexSessions,
  deleteCodexSession,
  renameCodexSession,
} from '../src/server/providers/codex.js';

const THREADS_TABLE_SQL = `CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  rollout_path TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  preview TEXT NOT NULL DEFAULT '',
  first_user_message TEXT NOT NULL DEFAULT '',
  updated_at INTEGER,
  updated_at_ms INTEGER
)`;

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

describe('discoverCodexSessions with state_5.sqlite present', () => {
  it('prefers a JSONL thread_name_updated rename over a stale SQLite title', async () => {
    const renamedJsonl = `${SAMPLE_CODEX_JSONL.trimEnd()}\n${JSON.stringify({
      timestamp: '2026-06-04T06:00:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'thread_name_updated',
        thread_id: '019e9124-2875-72f2-bda8-2060565c8e68',
        thread_name: 'Renamed Title',
      },
    })}\n`;
    await fs.writeFile(sessionFile, renamedJsonl, 'utf-8');

    const db = new Database(path.join(codexConfigDir, 'state_5.sqlite'));
    db.exec(THREADS_TABLE_SQL);
    db.prepare(
      'INSERT INTO threads (id, rollout_path, title, preview, first_user_message) VALUES (?, ?, ?, ?, ?)',
    ).run(
      '019e9124-2875-72f2-bda8-2060565c8e68',
      sessionFile,
      'Fix the login bug', // stale: original raw first-message text, never updated after the rename
      'Fix the login bug',
      'Fix the login bug',
    );
    db.close();

    const sessions = await discoverCodexSessions(codexConfigDir);
    const session = sessions.find(s => s.filePath === sessionFile);
    expect(session?.title).toBe('Renamed Title');
  });

  it('recovers a rename from session_index.jsonl even when it has scrolled past the tail window', async () => {
    // Simulate a session that kept going long after being renamed, so the
    // thread_name_updated event itself is no longer within the last 30 lines.
    const followUps = Array.from({ length: 40 }, (_, i) =>
      JSON.stringify({
        timestamp: `2026-06-04T07:${String(i).padStart(2, '0')}:00.000Z`,
        type: 'response_item',
        payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `follow up ${i}` }] },
      }),
    ).join('\n');
    const renamedThenBuriedJsonl = `${SAMPLE_CODEX_JSONL.trimEnd()}\n${JSON.stringify({
      timestamp: '2026-06-04T06:00:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'thread_name_updated',
        thread_id: '019e9124-2875-72f2-bda8-2060565c8e68',
        thread_name: 'Buried Rename',
      },
    })}\n${followUps}\n`;
    await fs.writeFile(sessionFile, renamedThenBuriedJsonl, 'utf-8');

    await fs.appendFile(
      path.join(codexConfigDir, 'session_index.jsonl'),
      `${JSON.stringify({
        id: '019e9124-2875-72f2-bda8-2060565c8e68',
        thread_name: 'Buried Rename',
        updated_at: '2026-06-04T06:00:00.000Z',
      })}\n`,
      'utf-8',
    );

    const sessions = await discoverCodexSessions(codexConfigDir);
    const session = sessions.find(s => s.filePath === sessionFile);
    expect(session?.title).toBe('Buried Rename');
  });

  it('falls back to SQLite preview/first_user_message when JSONL has no usable title and SQLite title is empty', async () => {
    // The only user-role message is system content (AGENTS.md), so JSONL alone would produce 'Untitled'.
    const jsonl = [
      '{"timestamp":"2026-06-04T05:38:46.641Z","type":"session_meta","payload":{"id":"019e9124-2875-72f2-bda8-2060565c8e68","cwd":"/home/user/project"}}',
      '{"timestamp":"2026-06-04T05:39:01.618Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"# AGENTS.md instructions\\nstuff"}]}}',
    ].join('\n') + '\n';
    await fs.writeFile(sessionFile, jsonl, 'utf-8');

    const db = new Database(path.join(codexConfigDir, 'state_5.sqlite'));
    db.exec(THREADS_TABLE_SQL);
    db.prepare(
      'INSERT INTO threads (id, rollout_path, title, preview, first_user_message) VALUES (?, ?, ?, ?, ?)',
    ).run('019e9124-2875-72f2-bda8-2060565c8e68', sessionFile, '', 'Clean preview from Codex', 'Clean preview from Codex');
    db.close();

    const sessions = await discoverCodexSessions(codexConfigDir);
    const session = sessions.find(s => s.filePath === sessionFile);
    expect(session?.title).toBe('Clean preview from Codex');
  });
});

describe('renameCodexSession', () => {
  it('updates the threads row via an extended-length-prefixed rollout_path when id does not match', async () => {
    const dbPath = path.join(codexConfigDir, 'state_5.sqlite');
    const db = new Database(dbPath);
    db.exec(THREADS_TABLE_SQL);
    const extendedPath = `\\\\?\\${path.resolve(sessionFile)}`;
    db.prepare('INSERT INTO threads (id, rollout_path, title) VALUES (?, ?, ?)').run(
      'a-different-thread-id-not-in-jsonl',
      extendedPath,
      'Old Title',
    );
    db.close();

    await renameCodexSession(sessionFile, 'Brand New Title', codexConfigDir);

    const verifyDb = new Database(dbPath, { readonly: true });
    const row = verifyDb
      .prepare('SELECT title FROM threads WHERE id = ?')
      .get('a-different-thread-id-not-in-jsonl') as { title: string } | undefined;
    verifyDb.close();
    expect(row?.title).toBe('Brand New Title');
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
