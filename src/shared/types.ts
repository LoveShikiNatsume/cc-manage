export type Provider = 'claude' | 'codex';

export interface SessionMeta {
  id: string;
  provider: Provider;
  title: string;
  project: string;
  cwd: string;
  lastActivity: number;
  filePath: string;
}

export interface SessionMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  sourceType?: string;
}

export interface ProjectGroup {
  name: string;
  cwd: string;
  sessions: SessionMeta[];
}

export interface ProviderGroup {
  provider: Provider;
  projects: ProjectGroup[];
}

export interface MemoryFileMeta {
  filename: string;
  name: string;
  description: string;
  type: string;
}

export interface MemoryFileContent extends MemoryFileMeta {
  body: string;
  rawContent: string;
}

export interface MemoryProject {
  project: string;
  projectDir: string;
  memories: MemoryFileMeta[];
}

export interface CodexMemoryEntry {
  threadId: string;
  rawMemory: string;
  rolloutSummary: string;
  rolloutSlug: string | null;
  generatedAt: number;
}

export interface UsageTier {
  name: string;
  label: string;
  utilization: number;
  resetAt: number;
  windowMinutes?: number;
  detail?: string;
}

export interface ProviderUsage {
  provider: Provider;
  tiers: UsageTier[];
  error?: string;
  tokenExpired?: boolean;
  source?: string;
  extra?: Record<string, string | number | boolean | null>;
}

export interface ClaudeRepairStats {
  nodes: number;
  roots: number;
  shown: number;
  hidden: number;
}

export interface ClaudeRepairIssue extends ClaudeRepairStats {
  id: string;
  title: string;
  project: string;
  filePath: string;
  lastActivity: number;
}

export interface ClaudeRepairResult {
  ok: boolean;
  filePath: string;
  backupPath?: string;
  changed?: boolean;
  dryRun?: boolean;
  before?: ClaudeRepairStats;
  after?: ClaudeRepairStats;
  mainNodes: number;
  relinked: number;
  inserted: number;
  droppedOrphans: number;
  leaf: string | null;
  error?: string;
}

export interface ClaudeMessageDeleteResult {
  ok: boolean;
  filePath: string;
  backupPath?: string;
  deletedIds: string[];
  deletedCount: number;
  repair: ClaudeRepairResult;
  error?: string;
}

export type ClaudeArtifactKind =
  | 'session-backup'
  | 'config-backup'
  | 'subagent'
  | 'tool-result'
  | 'plan'
  | 'job'
  | 'shell-snapshot'
  | 'session-env'
  | 'file-history'
  | 'telemetry'
  | 'cache'
  | 'config'
  | 'log'
  | 'large-storage'
  | 'project-file'
  | 'other';

export type ClaudeArtifactContentType =
  | 'markdown'
  | 'json'
  | 'jsonl'
  | 'shell'
  | 'text'
  | 'image'
  | 'binary'
  | 'directory';

export interface ClaudeArtifactItem {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  kind: ClaudeArtifactKind;
  scope: 'project' | 'global';
  project?: string;
  sessionId?: string;
  size: number;
  mtime: number;
  isDirectory: boolean;
  readable: boolean;
  deletable: boolean;
  contentType: ClaudeArtifactContentType;
  description?: string;
  fileCount?: number;
}

export interface ClaudeArtifactGroup {
  id: string;
  label: string;
  description: string;
  items: ClaudeArtifactItem[];
  totalCount: number;
  totalSize: number;
  truncated?: boolean;
}

export interface ClaudeArtifactsOverview {
  configDir: string;
  groups: ClaudeArtifactGroup[];
}

export interface ClaudeArtifactContent extends ClaudeArtifactItem {
  encoding: 'utf-8' | 'base64' | 'none';
  content?: string;
  truncated?: boolean;
}

export interface ClaudeArtifactDeleteResult {
  ok: boolean;
  path: string;
}
