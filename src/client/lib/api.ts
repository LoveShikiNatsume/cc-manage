import type {
  ProviderGroup,
  SessionMessage,
  MemoryProject,
  MemoryFileContent,
  CodexMemoryEntry,
  ProviderUsage,
} from '@shared/types';

const BASE = '/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });
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

export const getCodexMemory = (): Promise<CodexMemoryEntry[]> =>
  request('/memory/codex');

// ─── Usage ───────────────────────────────────────────────────────────────────

export const getUsage = (): Promise<ProviderUsage[]> =>
  request('/usage');
