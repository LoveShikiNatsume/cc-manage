import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import type { Dirent } from 'fs';
import type {
  ClaudeMessageDeleteResult,
  ClaudeRepairIssue,
  ClaudeRepairResult,
  ClaudeRepairStats,
} from '@shared/types.js';
import {
  extractClaudeSessionMeta,
  readHeadTail,
} from './session-parser.js';
import { withClaudeJsonlWriteLock } from './claude-jsonl-lock.js';

const SYNTHETIC_TOOL_RESULT =
  '[cc-fix:synthetic placeholder] The original Claude Code session was interrupted or branched before this tool call produced a result.';

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

async function loadJsonl(filePath: string): Promise<any[]> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const rows: any[] = [];
  for (const [index, line] of raw.split('\n').entries()) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      parsed.__line = index;
      rows.push(parsed);
    } catch {
      // Ignore malformed JSONL rows, matching the standalone cc-fix script.
    }
  }
  return rows;
}

function isMain(row: any): boolean {
  return Boolean(
    row?.uuid &&
      !row?.isSidechain &&
      ['user', 'assistant', 'attachment', 'system'].includes(row?.type),
  );
}

function isCompactBoundary(row: any): boolean {
  return row?.type === 'system' && row?.subtype === 'compact_boundary';
}

/**
 * Claude may deliberately start a new physical tree when compacting a session.
 * In that case logicalParentUuid is the bridge back to the pre-compact history.
 * Prefer a valid physical parent, and only use the logical parent as a fallback:
 * some Claude versions write both fields with different (but valid) meanings.
 */
function effectiveParentUuid(row: any, byUuid: Map<string, any>): string | null {
  const parentUuid = typeof row?.parentUuid === 'string' ? row.parentUuid : null;
  if (parentUuid && byUuid.has(parentUuid)) return parentUuid;

  const logicalParentUuid =
    typeof row?.logicalParentUuid === 'string' ? row.logicalParentUuid : null;
  if (isCompactBoundary(row) && logicalParentUuid && byUuid.has(logicalParentUuid)) {
    return logicalParentUuid;
  }

  return parentUuid;
}

function canonicalSet(rows: any[], byUuid: Map<string, any>): Set<string> {
  let leaf: string | null = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (isMain(row) && (row.type === 'assistant' || row.type === 'user')) {
      leaf = row.uuid;
      break;
    }
  }

  const seen = new Set<string>();
  let current = leaf;
  while (current && byUuid.has(current)) {
    if (seen.has(current)) break;
    seen.add(current);
    current = effectiveParentUuid(byUuid.get(current), byUuid);
  }
  return seen;
}

function hasAssistantText(row: any): boolean {
  if (row?.isSidechain) return false;
  const message = row?.message ?? {};
  if (message.role !== 'assistant') return false;
  const content = message.content;
  return (
    Array.isArray(content) &&
    content.some(block => block?.type === 'text' && String(block?.text ?? '').trim())
  );
}

export async function scanClaudeRepairFile(filePath: string): Promise<ClaudeRepairStats> {
  const rows = await loadJsonl(filePath);
  const byUuid = new Map<string, any>();
  for (const row of rows) {
    if (isMain(row) && !byUuid.has(row.uuid)) byUuid.set(row.uuid, row);
  }

  const compactions = [...byUuid.values()].filter(isCompactBoundary);
  const invalidCompactions = compactions.filter(row => {
    const physicalParentIsValid =
      typeof row.parentUuid === 'string' && byUuid.has(row.parentUuid);
    const logicalParentIsValid =
      typeof row.logicalParentUuid === 'string' && byUuid.has(row.logicalParentUuid);
    return !physicalParentIsValid && !logicalParentIsValid;
  }).length;
  const roots = [...byUuid.values()].filter(
    row => !byUuid.has(effectiveParentUuid(row, byUuid) ?? ''),
  ).length;
  const canonical = canonicalSet(rows, byUuid);
  const shown = [...canonical].filter(uuid => hasAssistantText(byUuid.get(uuid))).length;
  const hidden = [...byUuid.entries()].filter(
    ([uuid, row]) => !canonical.has(uuid) && hasAssistantText(row),
  ).length;

  return {
    nodes: byUuid.size,
    roots,
    shown,
    hidden,
    compactions: compactions.length,
    invalidCompactions,
  };
}

async function collectClaudeSessionFiles(projectsDir: string): Promise<string[]> {
  let projects: Dirent[];
  try {
    projects = await fs.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const projectDir = path.join(projectsDir, project.name);
    let entries: Dirent[];
    try {
      entries = await fs.readdir(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.jsonl')) continue;
      if (entry.name.startsWith('agent-')) continue;
      files.push(path.join(projectDir, entry.name));
    }
  }

  files.sort((a, b) => 0);
  return files;
}

export async function scanClaudeRepairIssues(
  configDir?: string,
): Promise<ClaudeRepairIssue[]> {
  const baseDir = configDir ?? getClaudeConfigDir();
  const projectsDir = path.join(baseDir, 'projects');
  const files = await collectClaudeSessionFiles(projectsDir);
  const issues: ClaudeRepairIssue[] = [];

  for (const filePath of files) {
    try {
      const stats = await scanClaudeRepairFile(filePath);
      if (stats.hidden === 0 && stats.roots <= 1) continue;

      const { headLines, tailLines } = await readHeadTail(filePath);
      const meta = extractClaudeSessionMeta(headLines, tailLines, filePath);
      issues.push({
        ...stats,
        id: meta.id,
        title: meta.title,
        project: meta.project,
        filePath,
        lastActivity: meta.lastActivity,
        repairable: stats.compactions === 0,
        repairBlockedReason: stats.compactions > 0
          ? 'Automatic repair is disabled for compacted sessions to preserve Claude compact boundaries.'
          : undefined,
      });
    } catch {
      // Skip unreadable or malformed sessions.
    }
  }

  issues.sort((a, b) => b.lastActivity - a.lastActivity);
  return issues;
}

function toolIds(content: unknown): { uses: string[]; results: string[] } {
  const uses: string[] = [];
  const results: string[] = [];
  if (!Array.isArray(content)) return { uses, results };

  for (const block of content) {
    if (block?.type === 'tool_use' && block.id) uses.push(block.id);
    if (block?.type === 'tool_result' && block.tool_use_id) {
      results.push(block.tool_use_id);
    }
  }

  return { uses, results };
}

function backupPathFor(filePath: string, backupDir?: string): string {
  return backupDir ? path.join(backupDir, `${path.basename(filePath)}.bak`) : `${filePath}.bak`;
}

function timestampForPath(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function createBackup(filePath: string, backupDir?: string): Promise<string> {
  if (backupDir) {
    await fs.mkdir(backupDir, { recursive: true });
  }

  const preferred = backupPathFor(filePath, backupDir);
  try {
    await fs.access(preferred);
  } catch {
    await fs.copyFile(filePath, preferred);
    return preferred;
  }

  const unique = backupDir
    ? path.join(backupDir, `${path.basename(filePath)}.${timestampForPath()}.bak`)
    : `${filePath}.${timestampForPath()}.bak`;
  await fs.copyFile(filePath, unique);
  return unique;
}

function dumpRow(row: any): string {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === '__line' || key === '__synthetic') continue;
    clean[key] = value;
  }
  return JSON.stringify(clean);
}

async function repairClaudeSessionFileUnlocked(
  filePath: string,
  opts: {
    configDir?: string;
    backup?: boolean;
    dryRun?: boolean;
    backupDir?: string;
    force?: boolean;
  } = {},
): Promise<ClaudeRepairResult> {
  await validatePath(filePath, opts.configDir);
  const before = await scanClaudeRepairFile(filePath);

  const rows = await loadJsonl(filePath);
  if (rows.length === 0) {
    return {
      ok: false,
      filePath,
      dryRun: opts.dryRun,
      mainNodes: 0,
      relinked: 0,
      inserted: 0,
      droppedOrphans: 0,
      leaf: null,
      error: 'Empty session file',
    };
  }

  if (before.compactions > 0 && (before.hidden > 0 || before.roots > 1 || opts.force)) {
    return {
      ok: false,
      filePath,
      dryRun: opts.dryRun,
      before,
      after: before,
      changed: false,
      mainNodes: before.nodes,
      relinked: 0,
      inserted: 0,
      droppedOrphans: 0,
      leaf: null,
      error: 'Automatic repair refused: this session contains Claude compact boundaries and requires manual review.',
    };
  }

  if (before.hidden === 0 && before.roots <= 1 && !opts.force) {
    const main = rows.filter(isMain);
    const leaf = [...main]
      .reverse()
      .find(row => row.type === 'assistant' || row.type === 'user')?.uuid ?? null;
    return {
      ok: true,
      filePath,
      dryRun: opts.dryRun,
      before,
      after: before,
      changed: false,
      mainNodes: new Set(main.map(row => row.uuid)).size,
      relinked: 0,
      inserted: 0,
      droppedOrphans: 0,
      leaf,
    };
  }

  let sessionId: string | null = null;
  const template: Record<string, unknown> = {};
  for (const row of rows) {
    if (typeof row.sessionId === 'string') sessionId = row.sessionId;
    if (isMain(row) && row.type === 'user' && Object.keys(template).length === 0) {
      for (const key of ['cwd', 'gitBranch', 'version', 'userType', 'entrypoint']) {
        if (row[key] !== undefined) template[key] = row[key];
      }
    }
  }
  if (template.userType === undefined) template.userType = 'external';

  const main: any[] = [];
  const seenMain = new Set<string>();
  for (const row of rows) {
    if (!isMain(row)) continue;
    if (seenMain.has(row.uuid)) continue;
    seenMain.add(row.uuid);
    main.push(row);
  }

  const fixed: any[] = [];
  const syntheticByPredecessor = new Map<string | null, any[]>();
  let inserted = 0;
  let droppedOrphans = 0;
  let openIds: Array<{ id: string; timestamp: unknown }> = [];

  const addSyntheticAfter = (predecessor: string | null, node: any) => {
    const existing = syntheticByPredecessor.get(predecessor) ?? [];
    existing.push(node);
    syntheticByPredecessor.set(predecessor, existing);
  };

  const makeSynthetic = (ids: string[], timestamp: unknown): any => {
    const node: any = {
      type: 'user',
      uuid: randomUUID(),
      parentUuid: null,
      isSidechain: false,
      sessionId,
      timestamp,
      message: {
        role: 'user',
        content: ids.map(id => ({
          type: 'tool_result',
          tool_use_id: id,
          content: SYNTHETIC_TOOL_RESULT,
          is_error: true,
        })),
      },
      __synthetic: true,
    };
    for (const [key, value] of Object.entries(template)) {
      if (value !== null && value !== undefined) node[key] = value;
    }
    return node;
  };

  const appendSynthetic = (ids: string[], timestamp: unknown) => {
    const predecessor = fixed.length > 0 ? fixed[fixed.length - 1].uuid : null;
    const node = makeSynthetic(ids, timestamp);
    addSyntheticAfter(predecessor, node);
    fixed.push(node);
  };

  for (const row of main) {
    const message = row.message ?? {};
    const role = message.role;
    const content = message.content;
    const { uses, results } = toolIds(content);
    const timestamp = row.timestamp ?? '';

    if (role === 'assistant') {
      if (openIds.length > 0) {
        appendSynthetic(openIds.map(item => item.id), openIds[openIds.length - 1].timestamp);
        inserted += 1;
        openIds = [];
      }

      fixed.push(row);
      for (const id of uses) openIds.push({ id, timestamp });
      continue;
    }

    if (Array.isArray(content) && results.length > 0) {
      const openSet = new Set(openIds.map(item => item.id));
      const newContent: any[] = [];

      for (const block of content) {
        if (block?.type !== 'tool_result') {
          newContent.push(block);
          continue;
        }

        const toolUseId = block.tool_use_id;
        if (openSet.has(toolUseId)) {
          newContent.push(block);
          openSet.delete(toolUseId);
          openIds = openIds.filter(item => item.id !== toolUseId);
        } else {
          droppedOrphans += 1;
        }
      }

      if (openIds.length > 0) {
        for (const item of openIds) {
          newContent.push({
            type: 'tool_result',
            tool_use_id: item.id,
            content: SYNTHETIC_TOOL_RESULT,
            is_error: true,
          });
        }
        inserted += openIds.length;
        openIds = [];
      }

      if (newContent.length > 0) {
        row.message.content = newContent;
        fixed.push(row);
      }
      continue;
    }

    if (openIds.length > 0) {
      appendSynthetic(openIds.map(item => item.id), openIds[openIds.length - 1].timestamp);
      inserted += 1;
      openIds = [];
    }
    fixed.push(row);
  }

  if (openIds.length > 0) {
    appendSynthetic(openIds.map(item => item.id), openIds[openIds.length - 1]?.timestamp ?? '');
    inserted += 1;
  }

  let parent: string | null = null;
  for (const row of fixed) {
    row.parentUuid = parent;
    parent = row.uuid;
  }

  const leaf = fixed.length > 0 ? fixed[fixed.length - 1].uuid : null;
  const fixedUuids = new Set(fixed.map(row => row.uuid));
  const relinked = main.filter(row => fixedUuids.has(row.uuid)).length;
  const result: ClaudeRepairResult = {
    ok: true,
    filePath,
    dryRun: opts.dryRun,
    before,
    mainNodes: fixed.length,
    relinked,
    inserted,
    droppedOrphans,
    leaf,
  };

  if (opts.dryRun) return result;

  if (opts.backup !== false) {
    result.backupPath = await createBackup(filePath, opts.backupDir);
  }

  const mainByUuid = new Map(main.map(row => [row.uuid, row]));
  const emitted = new Set<string>();
  const outLines: string[] = [];

  for (const synthetic of syntheticByPredecessor.get(null) ?? []) {
    outLines.push(dumpRow(synthetic));
  }

  for (const row of rows) {
    const uuid = row.uuid;
    if (isMain(row)) {
      if (!fixedUuids.has(uuid) || emitted.has(uuid)) continue;
      emitted.add(uuid);
      outLines.push(dumpRow(mainByUuid.get(uuid)));
      for (const synthetic of syntheticByPredecessor.get(uuid) ?? []) {
        outLines.push(dumpRow(synthetic));
      }
      continue;
    }

    if (row.type === 'last-prompt') {
      outLines.push(dumpRow({ ...row, leafUuid: leaf }));
      continue;
    }

    outLines.push(dumpRow(row));
  }

  await fs.writeFile(filePath, `${outLines.join('\n')}\n`, 'utf-8');
  result.after = await scanClaudeRepairFile(filePath);
  result.changed =
    before.hidden !== result.after.hidden ||
    before.roots !== result.after.roots ||
    inserted > 0 ||
    droppedOrphans > 0;
  return result;
}

export async function repairClaudeSessionFile(
  filePath: string,
  opts: {
    configDir?: string;
    backup?: boolean;
    dryRun?: boolean;
    backupDir?: string;
    force?: boolean;
  } = {},
): Promise<ClaudeRepairResult> {
  return withClaudeJsonlWriteLock(() => repairClaudeSessionFileUnlocked(filePath, opts));
}

async function deleteClaudeSessionMessagesUnlocked(
  filePath: string,
  messageIds: string[],
  opts: { configDir?: string; backup?: boolean; backupDir?: string } = {},
): Promise<ClaudeMessageDeleteResult> {
  await validatePath(filePath, opts.configDir);

  const before = await scanClaudeRepairFile(filePath);
  if (before.compactions > 0) {
    throw new Error(
      'Message deletion is disabled for compacted Claude sessions because relinking could corrupt compact history.',
    );
  }

  const requested = new Set(messageIds.filter(Boolean));
  if (requested.size === 0) {
    throw new Error('messageIds must not be empty');
  }

  const rows = await loadJsonl(filePath);
  const deletedIds: string[] = [];
  const filteredRows = rows.filter(row => {
    if (
      row?.uuid &&
      requested.has(row.uuid) &&
      !row?.isSidechain &&
      (row.type === 'user' || row.type === 'assistant')
    ) {
      deletedIds.push(row.uuid);
      return false;
    }
    return true;
  });

  if (deletedIds.length === 0) {
    throw new Error('No deletable Claude messages matched the requested ids');
  }

  const remainingConversationRows = filteredRows.filter(
    row => isMain(row) && (row.type === 'user' || row.type === 'assistant'),
  );
  if (remainingConversationRows.length === 0) {
    throw new Error('Cannot delete every user/assistant message in a session');
  }

  const backupPath = opts.backup === false ? undefined : await createBackup(filePath, opts.backupDir);
  const tempPath = `${filePath}.cc-manage-${randomUUID()}.tmp.jsonl`;

  try {
    await fs.writeFile(tempPath, `${filteredRows.map(dumpRow).join('\n')}\n`, 'utf-8');
    const repair = await repairClaudeSessionFile(tempPath, {
      configDir: opts.configDir,
      backup: false,
      force: true,
    });
    if (!repair.ok) {
      throw new Error(repair.error ?? 'Claude session could not be repaired after message deletion');
    }
    const repairedContent = await fs.readFile(tempPath, 'utf-8');
    await fs.writeFile(filePath, repairedContent, 'utf-8');

    const finalRepair: ClaudeRepairResult = {
      ...repair,
      filePath,
      backupPath,
      after: await scanClaudeRepairFile(filePath),
      changed: true,
    };

    return {
      ok: true,
      filePath,
      backupPath,
      deletedIds,
      deletedCount: deletedIds.length,
      repair: finalRepair,
    };
  } finally {
    await fs.rm(tempPath, { force: true });
  }
}

export async function deleteClaudeSessionMessages(
  filePath: string,
  messageIds: string[],
  opts: { configDir?: string; backup?: boolean; backupDir?: string } = {},
): Promise<ClaudeMessageDeleteResult> {
  return withClaudeJsonlWriteLock(() => deleteClaudeSessionMessagesUnlocked(filePath, messageIds, opts));
}

async function restoreClaudeRepairBackupUnlocked(
  filePath: string,
  opts: { configDir?: string; backupDir?: string } = {},
): Promise<void> {
  await validatePath(filePath, opts.configDir);
  const backupPath = backupPathFor(filePath, opts.backupDir);
  await validatePath(backupPath, opts.configDir);
  await fs.copyFile(backupPath, filePath);
}

export async function restoreClaudeRepairBackup(
  filePath: string,
  opts: { configDir?: string; backupDir?: string } = {},
): Promise<void> {
  return withClaudeJsonlWriteLock(() => restoreClaudeRepairBackupUnlocked(filePath, opts));
}
