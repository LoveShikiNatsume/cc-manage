import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import type { Dirent } from 'fs';
import type { SessionMeta, SessionMessage } from '@shared/types.js';
import {
  readHeadTail,
  extractCodexSessionMeta,
  parseCodexMessages,
} from '../services/session-parser.js';

export function getCodexConfigDir(): string {
  return path.join(os.homedir(), '.codex');
}

async function validatePath(filePath: string, configDir?: string): Promise<void> {
  const baseDir = configDir ?? getCodexConfigDir();
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) {
    throw new Error(
      `Path "${filePath}" is outside the Codex config directory "${baseDir}"`,
    );
  }
}

async function readCodexSessionId(filePath: string): Promise<string | null> {
  const content = await fs.readFile(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'session_meta' && typeof obj.payload?.id === 'string') {
        return obj.payload.id;
      }
    } catch {
      // Ignore malformed JSONL rows.
    }
  }
  return null;
}

function readCodexThreadTitles(configDir?: string): Map<string, string> {
  const baseDir = configDir ?? getCodexConfigDir();
  const dbPath = path.join(baseDir, 'state_5.sqlite');
  const titles = new Map<string, string>();

  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='threads'")
      .get();
    if (!table) return titles;

    const rows = db
      .prepare("SELECT id, title FROM threads WHERE title IS NOT NULL AND title <> ''")
      .all() as Array<{ id: string; title: string }>;
    for (const row of rows) {
      titles.set(row.id, row.title);
    }
  } catch {
    return titles;
  } finally {
    db?.close();
  }

  return titles;
}

// Recursively collect *.jsonl files from a directory
async function collectJsonlFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectJsonlFiles(fullPath);
      results.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      results.push(fullPath);
    }
  }

  return results;
}

// Check if a session_meta line indicates this is a subagent session.
// Subagent sessions have source.subagent === true in their session_meta payload.
function isSubagentSession(headLines: string[]): boolean {
  for (const line of headLines) {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type === 'session_meta' && obj.payload?.source) {
      const src = obj.payload.source;
      if (typeof src === 'object' && src !== null && src.subagent === true) {
        return true;
      }
    }
  }
  return false;
}

export async function discoverCodexSessions(configDir?: string): Promise<SessionMeta[]> {
  const baseDir = configDir ?? getCodexConfigDir();
  const threadTitles = readCodexThreadTitles(baseDir);

  const scanDirs = [
    path.join(baseDir, 'sessions'),
    path.join(baseDir, 'archived_sessions'),
  ];

  const sessions: SessionMeta[] = [];

  for (const scanDir of scanDirs) {
    // If the directory does not exist, skip it
    try {
      await fs.access(scanDir);
    } catch {
      continue;
    }

    const files = await collectJsonlFiles(scanDir);

    for (const filePath of files) {
      try {
        const { headLines, tailLines } = await readHeadTail(filePath);

        // Skip subagent sessions
        if (isSubagentSession(headLines)) continue;

        const meta = extractCodexSessionMeta(headLines, tailLines, filePath);
        const indexedTitle = threadTitles.get(meta.id);
        if (indexedTitle) meta.title = indexedTitle;
        sessions.push(meta);
      } catch {
        // Skip unreadable files
      }
    }
  }

  // Sort by lastActivity descending (most recent first)
  sessions.sort((a, b) => b.lastActivity - a.lastActivity);

  return sessions;
}

export async function getCodexMessages(
  filePath: string,
  configDir?: string,
): Promise<SessionMessage[]> {
  await validatePath(filePath, configDir);
  return parseCodexMessages(filePath);
}

export async function deleteCodexSession(
  filePath: string,
  configDir?: string,
): Promise<void> {
  await validatePath(filePath, configDir);
  // Remove JSONL file only (no sidecar for Codex)
  await fs.unlink(filePath);
}

export async function renameCodexSession(
  filePath: string,
  title: string,
  configDir?: string,
): Promise<void> {
  await validatePath(filePath, configDir);

  const baseDir = configDir ?? getCodexConfigDir();
  const id = await readCodexSessionId(filePath);
  if (!id) {
    throw new Error('Could not find Codex session id');
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const nowSec = Math.floor(nowMs / 1000);

  const event = {
    timestamp: nowIso,
    type: 'event_msg',
    payload: {
      type: 'thread_name_updated',
      thread_id: id,
      thread_name: title,
    },
  };

  await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf-8');

  const indexPath = path.join(baseDir, 'session_index.jsonl');
  const indexEntry = {
    id,
    thread_name: title,
    updated_at: nowIso,
  };
  await fs.appendFile(indexPath, `${JSON.stringify(indexEntry)}\n`, 'utf-8');

  const statePath = path.join(baseDir, 'state_5.sqlite');
  try {
    await fs.access(statePath);
  } catch {
    return;
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(statePath);
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='threads'")
      .get();
    if (!table) return;

    db.prepare(
      `UPDATE threads
       SET title = @title,
           updated_at = @updatedAt,
           updated_at_ms = @updatedAtMs
       WHERE id = @id OR rollout_path = @filePath`,
    ).run({
      id,
      filePath,
      title,
      updatedAt: nowSec,
      updatedAtMs: nowMs,
    });
  } catch {
    // Older Codex installs may not have state_5.sqlite; JSONL updates still work.
  } finally {
    db?.close();
  }
}
