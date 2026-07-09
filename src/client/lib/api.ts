import type {
  ProviderGroup,
  SessionMessage,
  MemoryProject,
  MemoryFileContent,
  CodexMemoryEntry,
  ProviderUsage,
  ClaudeRepairIssue,
  ClaudeRepairResult,
  ClaudeMessageDeleteResult,
  ClaudeDesktopSyncStatus,
  ClaudeArtifactsOverview,
  ClaudeArtifactContent,
  ClaudeArtifactDeleteResult,
  ClaudeArtifactBulkDeleteResult,
  ClaudeSessionArtifacts,
} from '@shared/types';

const BASE = '/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...(options?.headers as Record<string, string> ?? {}) };
  if (options?.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${url}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API error ${res.status}: ${text}`);
  }
  // DELETE returns 204 no-content
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export const getSessions = (): Promise<ProviderGroup[]> =>
  request('/sessions');

export const getMessages = (provider: string, id: string): Promise<SessionMessage[]> =>
  request(`/sessions/${provider}/${encodeURIComponent(id)}/messages`);

export const getSessionArtifacts = (
  provider: string,
  id: string,
): Promise<ClaudeSessionArtifacts> =>
  request(`/sessions/${provider}/${encodeURIComponent(id)}/artifacts`);

export const renameSession = (provider: string, id: string, title: string): Promise<void> =>
  request(`/sessions/${provider}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });

export const deleteSession = (provider: string, id: string): Promise<void> =>
  request(`/sessions/${provider}/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const batchDeleteSessions = (ids: { provider: string; id: string }[]): Promise<void> =>
  request('/sessions/batch-delete', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });

export const scanClaudeRepairs = (): Promise<ClaudeRepairIssue[]> =>
  request('/sessions/claude/repair-scan');

export const repairSession = (
  provider: string,
  id: string,
  backup = false,
): Promise<ClaudeRepairResult> =>
  request(`/sessions/${provider}/${encodeURIComponent(id)}/repair`, {
    method: 'POST',
    body: JSON.stringify({ backup }),
  });

export const repairAllClaudeSessions = (
  backup = false,
): Promise<{ results: ClaudeRepairResult[] }> =>
  request('/sessions/claude/repair-all', {
    method: 'POST',
    body: JSON.stringify({ backup }),
  });

export const deleteSessionMessages = (
  provider: string,
  id: string,
  messageIds: string[],
  backup = false,
): Promise<ClaudeMessageDeleteResult> =>
  request(`/sessions/${provider}/${encodeURIComponent(id)}/messages/delete`, {
    method: 'POST',
    body: JSON.stringify({ messageIds, backup }),
  });

export const getClaudeDesktopSyncStatus = (): Promise<ClaudeDesktopSyncStatus> =>
  request('/claude-desktop-sync');

export const runClaudeDesktopSync = (): Promise<ClaudeDesktopSyncStatus> =>
  request('/claude-desktop-sync/run', { method: 'POST' });

// ─── Memory ───────────────────────────────────────────────────────────────────

export const getClaudeMemory = (): Promise<MemoryProject[]> =>
  request('/memory/claude');

export const getClaudeMemoryFile = (
  project: string,
  file: string
): Promise<MemoryFileContent> =>
  request(`/memory/claude/${encodeURIComponent(project)}/${encodeURIComponent(file)}`);

export const createClaudeMemoryFile = (
  project: string,
  payload: { filename: string; name: string; description: string; type: string; body: string }
): Promise<void> =>
  request(`/memory/claude/${encodeURIComponent(project)}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const updateClaudeMemoryFile = (
  project: string,
  file: string,
  content: string
): Promise<void> =>
  request(`/memory/claude/${encodeURIComponent(project)}/${encodeURIComponent(file)}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });

export const deleteClaudeMemoryFile = (project: string, file: string): Promise<void> =>
  request(
    `/memory/claude/${encodeURIComponent(project)}/${encodeURIComponent(file)}`,
    { method: 'DELETE' }
  );

export const rebuildClaudeMemoryIndex = (project: string): Promise<void> =>
  request(`/memory/claude/${encodeURIComponent(project)}/index/rebuild`, {
    method: 'POST',
  });

export const getCodexMemory = (): Promise<CodexMemoryEntry[]> =>
  request('/memory/codex');

// ─── Usage ───────────────────────────────────────────────────────────────────

export const getUsage = (): Promise<ProviderUsage[]> =>
  request('/usage');

export const getProviderUsage = (provider: string): Promise<ProviderUsage> =>
  request(`/usage/${provider}`);

// ─── Claude Artifacts ────────────────────────────────────────────────────────

export const getClaudeArtifacts = (): Promise<ClaudeArtifactsOverview> =>
  request('/claude-artifacts');

export const getClaudeArtifactContent = (filePath: string): Promise<ClaudeArtifactContent> =>
  request(`/claude-artifacts/content?path=${encodeURIComponent(filePath)}`);

export const deleteClaudeArtifact = (filePath: string): Promise<ClaudeArtifactDeleteResult> =>
  request('/claude-artifacts', {
    method: 'DELETE',
    body: JSON.stringify({ path: filePath }),
  });

export const deleteAllClaudeArtifactBackups = (): Promise<ClaudeArtifactBulkDeleteResult> =>
  request('/claude-artifacts/backups', { method: 'DELETE' });
