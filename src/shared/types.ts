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
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
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
}

export interface ProviderUsage {
  provider: Provider;
  tiers: UsageTier[];
  error?: string;
  tokenExpired?: boolean;
}
