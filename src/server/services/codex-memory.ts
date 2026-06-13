import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import type { CodexMemoryEntry } from '@shared/types.js';

export function getCodexConfigDir(): string {
  return path.join(os.homedir(), '.codex');
}

export function listCodexMemories(dbPath?: string): CodexMemoryEntry[] {
  const resolvedPath = dbPath ?? path.join(getCodexConfigDir(), 'memories_1.sqlite');

  // Return empty array if the file doesn't exist
  if (!fs.existsSync(resolvedPath)) {
    return [];
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(resolvedPath, { readonly: true });

    // Check if the table exists
    const tableExists = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='stage1_outputs'",
      )
      .get();

    if (!tableExists) {
      return [];
    }

    const rows = db
      .prepare(
        'SELECT thread_id, raw_memory, rollout_summary, rollout_slug, generated_at FROM stage1_outputs',
      )
      .all() as Array<{
      thread_id: string;
      raw_memory: string;
      rollout_summary: string;
      rollout_slug: string | null;
      generated_at: number;
    }>;

    return rows.map(row => ({
      threadId: row.thread_id,
      rawMemory: row.raw_memory,
      rolloutSummary: row.rollout_summary,
      rolloutSlug: row.rollout_slug,
      generatedAt: row.generated_at,
    }));
  } catch {
    return [];
  } finally {
    db?.close();
  }
}
