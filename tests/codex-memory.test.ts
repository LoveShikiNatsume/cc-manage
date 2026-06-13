import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { listCodexMemories } from '../src/server/services/codex-memory.js';

let tmpDir: string;
let dbPath: string;

const CREATE_TABLE_SQL = `
CREATE TABLE stage1_outputs (
  thread_id TEXT PRIMARY KEY,
  source_updated_at INTEGER NOT NULL,
  raw_memory TEXT NOT NULL,
  rollout_summary TEXT NOT NULL,
  rollout_slug TEXT,
  generated_at INTEGER NOT NULL
);
`;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-memory-test-'));
  dbPath = path.join(tmpDir, 'memories_1.sqlite');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('listCodexMemories', () => {
  it('returns entries from the database', () => {
    const db = new Database(dbPath);
    db.exec(CREATE_TABLE_SQL);
    db.prepare(
      'INSERT INTO stage1_outputs (thread_id, source_updated_at, raw_memory, rollout_summary, rollout_slug, generated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('thread-001', 1000, 'raw memory text', 'rollout summary text', 'rollout-slug-1', 1700000000);
    db.prepare(
      'INSERT INTO stage1_outputs (thread_id, source_updated_at, raw_memory, rollout_summary, rollout_slug, generated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('thread-002', 2000, 'another raw memory', 'another summary', null, 1700001000);
    db.close();

    const entries = listCodexMemories(dbPath);
    expect(entries.length).toBe(2);

    const first = entries.find(e => e.threadId === 'thread-001');
    expect(first).toBeDefined();
    expect(first!.rawMemory).toBe('raw memory text');
    expect(first!.rolloutSummary).toBe('rollout summary text');
    expect(first!.rolloutSlug).toBe('rollout-slug-1');
    expect(first!.generatedAt).toBe(1700000000);

    const second = entries.find(e => e.threadId === 'thread-002');
    expect(second).toBeDefined();
    expect(second!.rolloutSlug).toBeNull();
  });

  it('returns empty array when database file does not exist', () => {
    const nonexistentPath = path.join(tmpDir, 'nonexistent.sqlite');
    const entries = listCodexMemories(nonexistentPath);
    expect(entries).toEqual([]);
  });

  it('returns empty array when table is empty', () => {
    const db = new Database(dbPath);
    db.exec(CREATE_TABLE_SQL);
    db.close();

    const entries = listCodexMemories(dbPath);
    expect(entries).toEqual([]);
  });

  it('returns empty array when table does not exist', () => {
    // Create empty database without the expected table
    const db = new Database(dbPath);
    db.exec('CREATE TABLE other_table (id INTEGER PRIMARY KEY)');
    db.close();

    const entries = listCodexMemories(dbPath);
    expect(entries).toEqual([]);
  });
});
