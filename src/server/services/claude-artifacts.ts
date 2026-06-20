import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { Dirent } from 'fs';
import type {
  ClaudeArtifactContent,
  ClaudeArtifactContentType,
  ClaudeArtifactBulkDeleteResult,
  ClaudeArtifactDeleteResult,
  ClaudeArtifactGroup,
  ClaudeArtifactItem,
  ClaudeArtifactKind,
  ClaudeArtifactsOverview,
  ClaudeSessionArtifacts,
} from '@shared/types.js';

const MAX_ITEMS_PER_GROUP = 500;
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

interface Classification {
  kind: ClaudeArtifactKind;
  scope: 'project' | 'global';
  project?: string;
  sessionId?: string;
  description?: string;
}

interface CollectState {
  items: ClaudeArtifactItem[];
  truncated: boolean;
}

export function getClaudeConfigDir(): string {
  return path.join(os.homedir(), '.claude');
}

function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + path.sep);
}

async function validatePath(filePath: string, configDir?: string): Promise<string> {
  const baseDir = path.resolve(configDir ?? getClaudeConfigDir());
  const resolved = path.resolve(filePath);
  if (!isInside(resolved, baseDir)) {
    throw new Error(`Path "${filePath}" is outside the Claude config directory "${baseDir}"`);
  }

  const [realBase, realTarget] = await Promise.all([
    fs.realpath(baseDir).catch(() => baseDir),
    fs.realpath(resolved).catch(() => resolved),
  ]);
  if (!isInside(realTarget, realBase)) {
    throw new Error(`Path "${filePath}" resolves outside the Claude config directory`);
  }

  return resolved;
}

async function readDirSafe(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function statSafe(filePath: string) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

function relativePath(filePath: string, configDir?: string): string {
  const baseDir = path.resolve(configDir ?? getClaudeConfigDir());
  return path.relative(baseDir, filePath) || '.';
}

function isSessionBackupName(name: string): boolean {
  return /\.jsonl(?:\..+)?\.bak$/i.test(name);
}

function sessionIdFromBackup(name: string): string | undefined {
  const match = name.match(/^(.*?)\.jsonl(?:\..+)?\.bak$/i);
  return match?.[1];
}

function classifyArtifactPath(
  filePath: string,
  configDir?: string,
): Classification {
  const rel = relativePath(filePath, configDir);
  const parts = rel.split(path.sep);
  const name = path.basename(filePath);

  if (parts[0] === 'projects' && parts.length >= 3) {
    const project = parts[1];

    if (parts.length === 3 && isSessionBackupName(name)) {
      return {
        kind: 'session-backup',
        scope: 'project',
        project,
        sessionId: sessionIdFromBackup(name),
        description: 'Claude session JSONL backup created before a repair or edit.',
      };
    }

    if (parts.length >= 5 && parts[3] === 'subagents') {
      return {
        kind: 'subagent',
        scope: 'project',
        project,
        sessionId: parts[2],
        description: 'Subagent transcript or metadata attached to a Claude session.',
      };
    }

    if (parts.length >= 5 && parts[3] === 'tool-results') {
      return {
        kind: 'tool-result',
        scope: 'project',
        project,
        sessionId: parts[2],
        description: 'Tool output artifact attached to a Claude session.',
      };
    }

    return {
      kind: 'project-file',
      scope: 'project',
      project,
      description: 'Project-level Claude file outside the main session JSONL.',
    };
  }

  if (parts[0] === 'backups') {
    return {
      kind: 'config-backup',
      scope: 'global',
      description: 'Claude configuration backup.',
    };
  }
  if (parts[0] === 'plans') return { kind: 'plan', scope: 'global', description: 'Claude plan file.' };
  if (parts[0] === 'jobs') return { kind: 'job', scope: 'global', description: 'Claude job state file.' };
  if (parts[0] === 'shell-snapshots') {
    return { kind: 'shell-snapshot', scope: 'global', description: 'Shell snapshot captured by Claude.' };
  }
  if (parts[0] === 'session-env') {
    return { kind: 'session-env', scope: 'global', sessionId: parts[1], description: 'Session environment file.' };
  }
  if (parts[0] === 'file-history') {
    return { kind: 'file-history', scope: 'global', sessionId: parts[1], description: 'Claude file-history snapshot.' };
  }
  if (parts[0] === 'telemetry') return { kind: 'telemetry', scope: 'global', description: 'Claude telemetry data.' };
  if (parts[0] === 'cache') return { kind: 'cache', scope: 'global', description: 'Claude cache file.' };
  if (parts[0] === 'remote' || parts[0] === 'plugins') {
    return {
      kind: 'large-storage',
      scope: 'global',
      description: 'Large Claude runtime/plugin storage. Listed as summary only.',
    };
  }
  if (name === 'CLAUDE.md' || name.startsWith('settings') && name.endsWith('.json')) {
    return { kind: 'config', scope: 'global', description: 'Claude global configuration file.' };
  }
  if (name.endsWith('.log') || name === '.last-cleanup') {
    return { kind: 'log', scope: 'global', description: 'Claude local log or maintenance marker.' };
  }

  return { kind: 'other', scope: 'global', description: 'Other Claude local file.' };
}

function detectContentType(
  filePath: string,
  isDirectory: boolean,
  kind: ClaudeArtifactKind,
): ClaudeArtifactContentType {
  if (isDirectory) return 'directory';
  const lower = path.basename(filePath).toLowerCase();
  const ext = path.extname(lower);

  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) return 'image';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  if (lower.endsWith('.jsonl') || lower.includes('.jsonl.')) return 'jsonl';
  if (lower.endsWith('.json') || lower.endsWith('.map')) return 'json';
  if (lower.endsWith('.sh') || kind === 'shell-snapshot') return 'shell';
  if (
    [
      '.txt',
      '.log',
      '.yaml',
      '.yml',
      '.toml',
      '.ini',
      '.env',
      '.csv',
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.py',
      '.rs',
      '.go',
      '.java',
      '.c',
      '.cpp',
      '.h',
      '.css',
      '.html',
    ].includes(ext)
  ) {
    return 'text';
  }

  if (
    [
      'subagent',
      'tool-result',
      'plan',
      'job',
      'session-env',
      'file-history',
      'telemetry',
      'cache',
      'config',
      'log',
      'project-file',
      'session-backup',
      'config-backup',
      'other',
    ].includes(kind)
  ) {
    return 'text';
  }

  return 'binary';
}

function mimeForImage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  return 'image/png';
}

function isDeletable(kind: ClaudeArtifactKind, isDirectory: boolean): boolean {
  if (isDirectory) return false;
  return kind === 'session-backup' || kind === 'config-backup';
}

function isReadable(contentType: ClaudeArtifactContentType): boolean {
  return !['binary', 'directory'].includes(contentType);
}

async function makeItem(
  filePath: string,
  configDir?: string,
  description?: string,
): Promise<ClaudeArtifactItem | null> {
  const stat = await statSafe(filePath);
  if (!stat) return null;

  const classification = classifyArtifactPath(filePath, configDir);
  const contentType = detectContentType(filePath, stat.isDirectory(), classification.kind);
  const rel = relativePath(filePath, configDir);

  return {
    id: rel,
    name: path.basename(filePath),
    path: filePath,
    relativePath: rel,
    kind: classification.kind,
    scope: classification.scope,
    project: classification.project,
    sessionId: classification.sessionId,
    size: stat.isDirectory() ? 0 : stat.size,
    mtime: stat.mtimeMs,
    isDirectory: stat.isDirectory(),
    readable: isReadable(contentType),
    deletable: isDeletable(classification.kind, stat.isDirectory()),
    contentType,
    description: description ?? classification.description,
  };
}

async function pushItem(
  state: CollectState,
  filePath: string,
  configDir?: string,
  description?: string,
): Promise<void> {
  if (state.items.length >= MAX_ITEMS_PER_GROUP) {
    state.truncated = true;
    return;
  }
  const item = await makeItem(filePath, configDir, description);
  if (item) state.items.push(item);
}

async function collectFiles(
  root: string,
  state: CollectState,
  configDir: string,
  opts: {
    maxDepth?: number;
    include?: (entry: Dirent, filePath: string) => boolean;
  } = {},
  depth = 0,
): Promise<void> {
  if (state.items.length >= MAX_ITEMS_PER_GROUP) {
    state.truncated = true;
    return;
  }
  const entries = await readDirSafe(root);
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (depth < (opts.maxDepth ?? 4)) {
        await collectFiles(filePath, state, configDir, opts, depth + 1);
      }
      if (state.items.length >= MAX_ITEMS_PER_GROUP) {
        state.truncated = true;
        return;
      }
      continue;
    }

    if (!entry.isFile()) continue;
    if (opts.include && !opts.include(entry, filePath)) continue;
    await pushItem(state, filePath, configDir);
    if (state.items.length >= MAX_ITEMS_PER_GROUP) {
      state.truncated = true;
      return;
    }
  }
}

function buildGroup(
  id: string,
  label: string,
  description: string,
  state: CollectState,
): ClaudeArtifactGroup {
  const items = [...state.items].sort((a, b) => b.mtime - a.mtime);
  return {
    id,
    label,
    description,
    items,
    totalCount: items.length,
    totalSize: items.reduce((sum, item) => sum + item.size, 0),
    truncated: state.truncated || undefined,
  };
}

async function listProjectArtifacts(configDir: string): Promise<ClaudeArtifactGroup[]> {
  const projectsDir = path.join(configDir, 'projects');
  const backups: CollectState = { items: [], truncated: false };
  const projectFiles: CollectState = { items: [], truncated: false };
  const projects = await readDirSafe(projectsDir);

  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const projectDir = path.join(projectsDir, project.name);
    const entries = await readDirSafe(projectDir);

    for (const entry of entries) {
      const entryPath = path.join(projectDir, entry.name);

      if (entry.isFile()) {
        if (isSessionBackupName(entry.name)) {
          await pushItem(backups, entryPath, configDir);
          continue;
        }
        if (!entry.name.endsWith('.jsonl')) {
          await pushItem(projectFiles, entryPath, configDir);
        }
        continue;
      }
    }
  }

  return [
    buildGroup(
      'session-backups',
      'Session Backups',
      'JSONL backups created before cc-manage repairs or message edits. These are safe to delete from this page.',
      backups,
    ),
    buildGroup(
      'project-files',
      'Project Files',
      'Other non-session project files stored by Claude, excluding memory files shown in the Memory tab.',
      projectFiles,
    ),
  ];
}

export async function listClaudeSessionArtifacts(
  sessionFilePath: string,
  opts: { configDir?: string } = {},
): Promise<ClaudeSessionArtifacts> {
  const configDir = path.resolve(opts.configDir ?? getClaudeConfigDir());
  const resolved = await validatePath(sessionFilePath, configDir);
  if (!resolved.endsWith('.jsonl')) {
    throw new Error('Claude session path must be a JSONL file');
  }

  const sessionId = path.basename(resolved, '.jsonl');
  const sidecarDir = path.join(path.dirname(resolved), sessionId);
  const subagents: CollectState = { items: [], truncated: false };
  const toolResults: CollectState = { items: [], truncated: false };
  const fileHistory: CollectState = { items: [], truncated: false };
  const sessionEnv: CollectState = { items: [], truncated: false };
  const telemetry: CollectState = { items: [], truncated: false };
  const backups: CollectState = { items: [], truncated: false };
  const referencedPlans: CollectState = { items: [], truncated: false };
  const referencedJobs: CollectState = { items: [], truncated: false };
  const referencedSnapshots: CollectState = { items: [], truncated: false };
  const referencedProjectFiles: CollectState = { items: [], truncated: false };

  await collectFiles(path.join(sidecarDir, 'subagents'), subagents, configDir, { maxDepth: 2 });
  await collectFiles(path.join(sidecarDir, 'tool-results'), toolResults, configDir, { maxDepth: 6 });
  await collectFiles(path.join(configDir, 'file-history', sessionId), fileHistory, configDir, { maxDepth: 3 });
  await collectFiles(path.join(configDir, 'session-env', sessionId), sessionEnv, configDir, { maxDepth: 3 });
  await collectFiles(path.join(configDir, 'telemetry'), telemetry, configDir, {
    maxDepth: 4,
    include: entry => entry.name.includes(`.${sessionId}.`),
  });

  const projectDir = path.dirname(resolved);
  const projectEntries = await readDirSafe(projectDir);
  for (const entry of projectEntries) {
    if (!entry.isFile()) continue;
    if (isSessionBackupName(entry.name) && sessionIdFromBackup(entry.name) === sessionId) {
      await pushItem(backups, path.join(projectDir, entry.name), configDir);
    }
  }

  const sessionText = await fs.readFile(resolved, 'utf-8').catch(() => '');
  const collectReferenced = async (root: string, state: CollectState, maxDepth: number) => {
    await collectFiles(root, state, configDir, {
      maxDepth,
      include: entry => sessionText.includes(entry.name),
    });
  };
  await collectReferenced(path.join(configDir, 'plans'), referencedPlans, 2);
  await collectReferenced(path.join(configDir, 'shell-snapshots'), referencedSnapshots, 1);

  const allJobs: CollectState = { items: [], truncated: false };
  await collectFiles(path.join(configDir, 'jobs'), allJobs, configDir, { maxDepth: 3 });
  for (const item of allJobs.items) {
    const text = await fs.readFile(item.path, 'utf-8').catch(() => '');
    if (text.includes(sessionId)) referencedJobs.items.push(item);
  }

  for (const entry of projectEntries) {
    if (!entry.isFile() || entry.name.endsWith('.jsonl') || isSessionBackupName(entry.name)) continue;
    if (sessionText.includes(entry.name)) {
      await pushItem(referencedProjectFiles, path.join(projectDir, entry.name), configDir);
    }
  }

  const groups = [
    buildGroup('tool-results', 'Tool Results', 'Tool output files attached to this Claude session.', toolResults),
    buildGroup('subagents', 'Subagents', 'Subagent transcripts and metadata attached to this Claude session.', subagents),
    buildGroup('file-history', 'File History', 'File versions captured while this session edited the workspace.', fileHistory),
    buildGroup('session-env', 'Session Environment', 'Environment snapshots owned by this session.', sessionEnv),
    buildGroup('telemetry', 'Diagnostics', 'Claude diagnostic events tagged with this session id.', telemetry),
    buildGroup('plans', 'Referenced Plans', 'Plan files explicitly referenced by this conversation.', referencedPlans),
    buildGroup('jobs', 'Background Jobs', 'Job state files that reference this session id.', referencedJobs),
    buildGroup('shell-snapshots', 'Shell Snapshots', 'Shell snapshots explicitly referenced by this conversation.', referencedSnapshots),
    buildGroup('session-backups', 'Session Backups', 'Backups of this session created before repairs or message edits.', backups),
    buildGroup('project-files', 'Referenced Project Files', 'Project helper files explicitly referenced by this conversation.', referencedProjectFiles),
  ].filter(group => group.items.length > 0);

  return {
    sessionId,
    totalCount: groups.reduce((sum, group) => sum + group.totalCount, 0),
    groups,
  };
}

async function listGlobalArtifacts(configDir: string): Promise<ClaudeArtifactGroup[]> {
  const plans: CollectState = { items: [], truncated: false };
  const jobs: CollectState = { items: [], truncated: false };
  const snapshots: CollectState = { items: [], truncated: false };
  const cache: CollectState = { items: [], truncated: false };
  const config: CollectState = { items: [], truncated: false };
  const large: CollectState = { items: [], truncated: false };

  await collectFiles(path.join(configDir, 'plans'), plans, configDir, { maxDepth: 2 });
  await collectFiles(path.join(configDir, 'jobs'), jobs, configDir, { maxDepth: 3 });
  await collectFiles(path.join(configDir, 'shell-snapshots'), snapshots, configDir, { maxDepth: 1 });
  await collectFiles(path.join(configDir, 'cache'), cache, configDir, { maxDepth: 3 });
  await collectFiles(path.join(configDir, 'backups'), config, configDir, { maxDepth: 2 });

  const rootEntries = await readDirSafe(configDir);
  for (const entry of rootEntries) {
    if (!entry.isFile()) continue;
    if (
      entry.name === 'CLAUDE.md' ||
      entry.name === 'settings.json' ||
      entry.name === 'settings.local.json' ||
      entry.name.endsWith('.log') ||
      entry.name === '.last-cleanup'
    ) {
      await pushItem(config, path.join(configDir, entry.name), configDir);
    }
  }

  for (const dir of ['remote', 'plugins']) {
    const dirPath = path.join(configDir, dir);
    const item = await makeItem(
      dirPath,
      configDir,
      'Large Claude runtime/plugin storage. It is summarized here and intentionally not deletable.',
    );
    if (item) {
      item.readable = false;
      item.deletable = false;
      large.items.push(item);
    }
  }

  return [
    buildGroup('plans', 'Plans', 'Markdown plans stored under ~/.claude/plans.', plans),
    buildGroup('jobs', 'Jobs', 'Claude job state and pin files.', jobs),
    buildGroup('shell-snapshots', 'Shell Snapshots', 'Shell environment snapshots captured by Claude.', snapshots),
    buildGroup('cache-config', 'Cache & Config', 'Cache files, logs, settings, and Claude config backups.', cache),
    buildGroup('root-config', 'Root Config', 'Global Claude settings, logs, and backup files.', config),
    buildGroup('large-storage', 'Large Storage', 'Runtime and plugin directories are shown as read-only summaries.', large),
  ];
}

export async function listClaudeArtifacts(configDir?: string): Promise<ClaudeArtifactsOverview> {
  const baseDir = path.resolve(configDir ?? getClaudeConfigDir());
  const [projectGroups, globalGroups] = await Promise.all([
    listProjectArtifacts(baseDir),
    listGlobalArtifacts(baseDir),
  ]);

  return {
    configDir: baseDir,
    groups: [...projectGroups, ...globalGroups].filter(
      group => group.items.length > 0 || group.id === 'large-storage',
    ),
  };
}

export async function readClaudeArtifactContent(
  filePath: string,
  opts: { configDir?: string } = {},
): Promise<ClaudeArtifactContent> {
  const resolved = await validatePath(filePath, opts.configDir);
  const item = await makeItem(resolved, opts.configDir);
  if (!item) throw new Error('Artifact not found');
  if (item.isDirectory || item.contentType === 'directory') {
    return { ...item, encoding: 'none' };
  }
  if (!item.readable) {
    return { ...item, encoding: 'none' };
  }

  if (item.contentType === 'image') {
    if (item.size > MAX_IMAGE_BYTES) {
      return { ...item, encoding: 'none', truncated: true };
    }
    const buf = await fs.readFile(resolved);
    return {
      ...item,
      encoding: 'base64',
      content: `data:${mimeForImage(resolved)};base64,${buf.toString('base64')}`,
    };
  }

  const handle = await fs.open(resolved, 'r');
  try {
    const buffer = Buffer.alloc(MAX_TEXT_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, MAX_TEXT_BYTES + 1, 0);
    const slice = buffer.subarray(0, Math.min(bytesRead, MAX_TEXT_BYTES));
    if (slice.includes(0)) {
      return { ...item, contentType: 'binary', readable: false, encoding: 'none' };
    }

    return {
      ...item,
      encoding: 'utf-8',
      content: slice.toString('utf-8'),
      truncated: bytesRead > MAX_TEXT_BYTES || undefined,
    };
  } finally {
    await handle.close();
  }
}

export async function deleteClaudeArtifact(
  filePath: string,
  opts: { configDir?: string } = {},
): Promise<ClaudeArtifactDeleteResult> {
  const resolved = await validatePath(filePath, opts.configDir);
  const item = await makeItem(resolved, opts.configDir);
  if (!item) throw new Error('Artifact not found');
  if (!item.deletable) {
    throw new Error('Only Claude backup artifacts can be deleted from this page');
  }

  await fs.rm(resolved, { force: true });
  return { ok: true, path: resolved };
}

export async function deleteAllClaudeArtifactBackups(
  opts: { configDir?: string } = {},
): Promise<ClaudeArtifactBulkDeleteResult> {
  const overview = await listClaudeArtifacts(opts.configDir);
  const backups = overview.groups.flatMap(group => group.items).filter(item => item.deletable);
  const results = await Promise.allSettled(
    backups.map(item => deleteClaudeArtifact(item.path, opts)),
  );
  const deletedCount = results.filter(result => result.status === 'fulfilled').length;
  return {
    ok: deletedCount === results.length,
    deletedCount,
    failedCount: results.length - deletedCount,
  };
}
