import fs from 'fs/promises';
import path from 'path';
import os from 'os';
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

// Recursively collect *.jsonl files from a directory
async function collectJsonlFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  let entries: fs.Dirent[];
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
