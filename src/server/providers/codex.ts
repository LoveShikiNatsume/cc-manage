import fs from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import type { Dirent } from 'fs';
import type { SessionMeta, SessionMessage } from '@shared/types.js';
import {
  readHeadTail,
  extractCodexSessionMeta,
  extractCodexTitleCandidates,
  resolveTitleFromCandidates,
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

export interface CodexThreadRow {
  title: string | null;
  preview: string | null;
  firstUserMessage: string | null;
}

// Codex's own state_5.sqlite carries three name-like columns per thread.
// `title` is what Codex's rename UI writes, but it can go stale relative to
// the JSONL's own `thread_name_updated` event (the write can silently fail --
// see renameCodexSession below), so callers must treat this as one candidate
// among several, not an unconditional override.
function readCodexThreadRows(configDir?: string): Map<string, CodexThreadRow> {
  const baseDir = configDir ?? getCodexConfigDir();
  const dbPath = path.join(baseDir, 'state_5.sqlite');
  const rows = new Map<string, CodexThreadRow>();

  // Missing state_5.sqlite is a normal, expected case (fresh/older Codex
  // installs) -- only log once we know the file exists but reading it failed.
  if (!existsSync(dbPath)) {
    return rows;
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='threads'")
      .get();
    if (!table) return rows;

    const threadRows = db
      .prepare('SELECT id, title, preview, first_user_message FROM threads')
      .all() as Array<{ id: string; title: string | null; preview: string | null; first_user_message: string | null }>;
    for (const row of threadRows) {
      rows.set(row.id, {
        title: row.title,
        preview: row.preview,
        firstUserMessage: row.first_user_message,
      });
    }
  } catch (error) {
    console.error(`[codex] failed to read ${dbPath}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    db?.close();
  }

  return rows;
}

// renameCodexSession appends every rename to this small, dedicated,
// append-only index (in addition to the session's own JSONL). Unlike the
// per-session `thread_name_updated` tail scan, this file only grows by one
// line per rename rather than one line per message, so it doesn't suffer the
// same truncation problem: a rename made early in a long-running session can
// easily fall outside TAIL_LINES once enough later messages pile up.
function readSessionRenameIndex(configDir?: string): Map<string, string> {
  const baseDir = configDir ?? getCodexConfigDir();
  const indexPath = path.join(baseDir, 'session_index.jsonl');
  const renames = new Map<string, string>();

  if (!existsSync(indexPath)) {
    return renames;
  }

  let content: string;
  try {
    content = readFileSync(indexPath, 'utf-8');
  } catch (error) {
    console.error(`[codex] failed to read ${indexPath}: ${error instanceof Error ? error.message : String(error)}`);
    return renames;
  }

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (typeof entry?.id === 'string' && typeof entry?.thread_name === 'string' && entry.thread_name) {
        renames.set(entry.id, entry.thread_name); // appended chronologically -- last one per id wins
      }
    } catch {
      // Ignore malformed lines.
    }
  }

  return renames;
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
  const threadRows = readCodexThreadRows(baseDir);
  const renameIndex = readSessionRenameIndex(baseDir);

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
        const row = threadRows.get(meta.id);
        const titleCandidates = extractCodexTitleCandidates(headLines, tailLines);
        meta.title = resolveTitleFromCandidates([
          renameIndex.get(meta.id),
          titleCandidates.threadNameUpdated,
          row?.title,
          row?.preview,
          row?.firstUserMessage,
          titleCandidates.sessionMetaThreadName,
          titleCandidates.firstUserPrompt,
        ]) ?? 'Untitled';
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

    // rollout_path in threads can carry a Windows extended-length \\?\ prefix
    // that our own filePath never has, so a plain string match against
    // filePath alone silently fails to update the row on Windows.
    const resolvedFilePath = path.resolve(filePath);
    const extendedFilePath = resolvedFilePath.startsWith('\\\\?\\')
      ? resolvedFilePath
      : `\\\\?\\${resolvedFilePath}`;

    const result = db.prepare(
      `UPDATE threads
       SET title = @title,
           updated_at = @updatedAt,
           updated_at_ms = @updatedAtMs
       WHERE id = @id OR rollout_path = @filePath OR rollout_path = @extendedFilePath`,
    ).run({
      id,
      filePath: resolvedFilePath,
      extendedFilePath,
      title,
      updatedAt: nowSec,
      updatedAtMs: nowMs,
    });

    if (result.changes === 0) {
      console.error(`[codex] rename: no threads row matched id=${id} or rollout_path for ${resolvedFilePath}`);
    }
  } catch (error) {
    // Older Codex installs may not have state_5.sqlite; JSONL updates still work either way.
    console.error(`[codex] failed to update ${statePath}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    db?.close();
  }
}
