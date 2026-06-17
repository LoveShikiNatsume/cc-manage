import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { SessionMeta, SessionMessage } from '@shared/types.js';
import {
  readHeadTail,
  extractClaudeSessionMeta,
  parseClaudeMessages,
} from '../services/session-parser.js';

export function getClaudeConfigDir(): string {
  return path.join(os.homedir(), '.claude');
}

async function validatePath(filePath: string, configDir?: string): Promise<void> {
  const baseDir = configDir ?? getClaudeConfigDir();
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) {
    throw new Error(
      `Path "${filePath}" is outside the Claude config directory "${baseDir}"`,
    );
  }
}

async function readClaudeSessionId(filePath: string): Promise<string | null> {
  const content = await fs.readFile(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (typeof obj.sessionId === 'string') return obj.sessionId;
      if (obj.type === 'queue-operation' && typeof obj.sessionId === 'string') {
        return obj.sessionId;
      }
    } catch {
      // Ignore malformed JSONL rows.
    }
  }
  return null;
}

export async function discoverClaudeSessions(configDir?: string): Promise<SessionMeta[]> {
  const baseDir = configDir ?? getClaudeConfigDir();
  const projectsDir = path.join(baseDir, 'projects');

  // If the projects directory does not exist, return empty
  try {
    await fs.access(projectsDir);
  } catch {
    return [];
  }

  const sessions: SessionMeta[] = [];

  // Enumerate project subdirectories
  let projectEntries: fs.Dirent[];
  try {
    projectEntries = await fs.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory()) continue;
    const projectPath = path.join(projectsDir, projectEntry.name);

    let fileEntries: fs.Dirent[];
    try {
      fileEntries = await fs.readdir(projectPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const fileEntry of fileEntries) {
      if (!fileEntry.isFile()) continue;
      if (!fileEntry.name.endsWith('.jsonl')) continue;
      // Skip agent- prefixed files
      if (fileEntry.name.startsWith('agent-')) continue;

      const filePath = path.join(projectPath, fileEntry.name);
      try {
        const { headLines, tailLines } = await readHeadTail(filePath);
        const meta = extractClaudeSessionMeta(headLines, tailLines, filePath);
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

export async function getClaudeMessages(
  filePath: string,
  configDir?: string,
): Promise<SessionMessage[]> {
  await validatePath(filePath, configDir);
  return parseClaudeMessages(filePath);
}

export async function deleteClaudeSession(
  filePath: string,
  configDir?: string,
): Promise<void> {
  await validatePath(filePath, configDir);

  // Remove the JSONL file
  await fs.unlink(filePath);

  // Remove the sidecar directory (same name without .jsonl extension)
  const sidecarDir = filePath.replace(/\.jsonl$/, '');
  try {
    await fs.rm(sidecarDir, { recursive: true, force: true });
  } catch {
    // Sidecar directory might not exist; that's fine
  }
}

export async function renameClaudeSession(
  filePath: string,
  title: string,
  configDir?: string,
): Promise<void> {
  await validatePath(filePath, configDir);

  const sessionId = await readClaudeSessionId(filePath);
  const entry = {
    type: 'custom-title',
    ...(sessionId ? { sessionId } : {}),
    customTitle: title,
    timestamp: new Date().toISOString(),
  };

  // Append a newline-terminated JSON entry to the file
  await fs.appendFile(filePath, JSON.stringify(entry) + '\n', 'utf-8');
}
