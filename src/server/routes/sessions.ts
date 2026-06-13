import type { FastifyPluginAsync } from 'fastify';
import type { Provider, ProviderGroup, ProjectGroup, SessionMeta } from '@shared/types.js';
import {
  discoverClaudeSessions,
  getClaudeMessages,
  deleteClaudeSession,
  renameClaudeSession,
} from '../providers/claude.js';
import {
  discoverCodexSessions,
  getCodexMessages,
  deleteCodexSession,
} from '../providers/codex.js';

interface SessionsPluginOptions {
  claudeConfigDir?: string;
  codexConfigDir?: string;
}

// In-memory map: "<provider>:<sessionId>" => filePath
const sessionMap = new Map<string, { filePath: string; provider: Provider }>();

function sessionKey(provider: Provider, id: string): string {
  return `${provider}:${id}`;
}

async function refreshSessionMap(
  claudeConfigDir?: string,
  codexConfigDir?: string,
): Promise<SessionMeta[]> {
  const [claudeSessions, codexSessions] = await Promise.all([
    discoverClaudeSessions(claudeConfigDir),
    discoverCodexSessions(codexConfigDir),
  ]);

  const allSessions = [...claudeSessions, ...codexSessions];

  // Refresh the map
  sessionMap.clear();
  for (const s of allSessions) {
    sessionMap.set(sessionKey(s.provider, s.id), {
      filePath: s.filePath,
      provider: s.provider,
    });
  }

  return allSessions;
}

function groupSessions(sessions: SessionMeta[]): ProviderGroup[] {
  const providerMap = new Map<Provider, Map<string, { cwd: string; sessions: SessionMeta[] }>>();

  for (const s of sessions) {
    if (!providerMap.has(s.provider)) {
      providerMap.set(s.provider, new Map());
    }
    const projectMap = providerMap.get(s.provider)!;
    if (!projectMap.has(s.project)) {
      projectMap.set(s.project, { cwd: s.cwd, sessions: [] });
    }
    projectMap.get(s.project)!.sessions.push(s);
  }

  const result: ProviderGroup[] = [];
  for (const [provider, projectMap] of providerMap) {
    const projects: ProjectGroup[] = [];
    for (const [name, { cwd, sessions }] of projectMap) {
      projects.push({ name, cwd, sessions });
    }
    result.push({ provider, projects });
  }

  return result;
}

export const sessionsRoutes: FastifyPluginAsync<SessionsPluginOptions> = async (
  app,
  opts,
) => {
  const { claudeConfigDir, codexConfigDir } = opts;

  // GET /api/sessions
  app.get('/api/sessions', async (_req, reply) => {
    const sessions = await refreshSessionMap(claudeConfigDir, codexConfigDir);
    const grouped = groupSessions(sessions);
    return reply.send(grouped);
  });

  // GET /api/sessions/:provider/:id/messages
  app.get<{
    Params: { provider: string; id: string };
  }>('/api/sessions/:provider/:id/messages', async (req, reply) => {
    const { provider, id } = req.params;
    const entry = sessionMap.get(sessionKey(provider as Provider, id));
    if (!entry) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    try {
      let messages;
      if (entry.provider === 'claude') {
        messages = await getClaudeMessages(entry.filePath, claudeConfigDir);
      } else {
        messages = await getCodexMessages(entry.filePath, codexConfigDir);
      }
      return reply.send(messages);
    } catch (err) {
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // PATCH /api/sessions/:provider/:id — rename (Claude only)
  app.patch<{
    Params: { provider: string; id: string };
    Body: { title: string };
  }>('/api/sessions/:provider/:id', async (req, reply) => {
    const { provider, id } = req.params;
    const { title } = req.body ?? {};

    if (typeof title !== 'string' || !title.trim()) {
      return reply.status(400).send({ error: 'title is required' });
    }

    if (provider !== 'claude') {
      return reply.status(400).send({ error: 'Rename is only supported for Claude sessions' });
    }

    const entry = sessionMap.get(sessionKey(provider as Provider, id));
    if (!entry) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    try {
      await renameClaudeSession(entry.filePath, title, claudeConfigDir);
      return reply.send({ ok: true });
    } catch (err) {
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // DELETE /api/sessions/:provider/:id
  app.delete<{
    Params: { provider: string; id: string };
  }>('/api/sessions/:provider/:id', async (req, reply) => {
    const { provider, id } = req.params;
    const entry = sessionMap.get(sessionKey(provider as Provider, id));
    if (!entry) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    try {
      if (entry.provider === 'claude') {
        await deleteClaudeSession(entry.filePath, claudeConfigDir);
      } else {
        await deleteCodexSession(entry.filePath, codexConfigDir);
      }
      sessionMap.delete(sessionKey(provider as Provider, id));
      return reply.send({ ok: true });
    } catch (err) {
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // POST /api/sessions/batch-delete
  app.post<{
    Body: { ids: Array<{ provider: string; id: string }> };
  }>('/api/sessions/batch-delete', async (req, reply) => {
    const { ids } = req.body ?? {};

    if (!Array.isArray(ids)) {
      return reply.status(400).send({ error: 'ids must be an array' });
    }

    const results: Array<{ provider: string; id: string; ok: boolean; error?: string }> = [];

    for (const { provider, id } of ids) {
      const entry = sessionMap.get(sessionKey(provider as Provider, id));
      if (!entry) {
        results.push({ provider, id, ok: false, error: 'Session not found' });
        continue;
      }

      try {
        if (entry.provider === 'claude') {
          await deleteClaudeSession(entry.filePath, claudeConfigDir);
        } else {
          await deleteCodexSession(entry.filePath, codexConfigDir);
        }
        sessionMap.delete(sessionKey(provider as Provider, id));
        results.push({ provider, id, ok: true });
      } catch (err) {
        results.push({
          provider,
          id,
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return reply.send({ results });
  });
};
