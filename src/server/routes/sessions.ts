import type { FastifyPluginAsync } from 'fastify';
import type { Provider, ProviderGroup, ProjectGroup, SessionMeta } from '@shared/types.js';
import type { ClaudeDesktopAutoSyncController } from '../services/claude-desktop-sync/background.js';
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
  renameCodexSession,
} from '../providers/codex.js';
import {
  deleteClaudeSessionMessages,
  repairClaudeSessionFile,
  scanClaudeRepairIssues,
} from '../services/claude-repair.js';
import { recordCliSessionDeleted } from '../services/claude-desktop-sync/state.js';
import { withClaudeJsonlWriteLock } from '../services/claude-jsonl-lock.js';
import { listClaudeSessionArtifacts } from '../services/claude-artifacts.js';
import {
  projectGroupKey,
  projectNameFromCwd,
  isCodexScratchCwd,
  CODEX_NO_PROJECT_KEY,
  CODEX_NO_PROJECT_NAME,
} from '../services/project-path.js';

interface SessionsPluginOptions {
  claudeConfigDir?: string;
  codexConfigDir?: string;
  claudeDesktopSync?: ClaudeDesktopAutoSyncController;
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

// Resolve the grouping bucket for a session. Project-less Codex chats (run
// without a project, or via Codex Desktop's throwaway scratch workspaces) are
// folded into a single "(no project)" bucket instead of one group per cwd.
function resolveProjectBucket(s: SessionMeta): { key: string; name: string; cwd: string } {
  if (s.provider === 'codex' && (!s.cwd || isCodexScratchCwd(s.cwd))) {
    return { key: CODEX_NO_PROJECT_KEY, name: CODEX_NO_PROJECT_NAME, cwd: '' };
  }
  return {
    key: projectGroupKey(s.cwd) || s.project || 'unknown',
    name: projectNameFromCwd(s.cwd) || s.project || 'unknown',
    cwd: s.cwd,
  };
}

function groupSessions(sessions: SessionMeta[]): ProviderGroup[] {
  const providerMap = new Map<
    Provider,
    Map<string, { name: string; cwd: string; sessions: SessionMeta[] }>
  >();

  for (const s of sessions) {
    if (!providerMap.has(s.provider)) {
      providerMap.set(s.provider, new Map());
    }
    const projectMap = providerMap.get(s.provider)!;
    const { key, name, cwd } = resolveProjectBucket(s);
    if (!projectMap.has(key)) {
      projectMap.set(key, { name, cwd, sessions: [] });
    }
    projectMap.get(key)!.sessions.push(s);
  }

  const result: ProviderGroup[] = [];
  for (const [provider, projectMap] of providerMap) {
    const projects: ProjectGroup[] = [];
    for (const { name, cwd, sessions } of projectMap.values()) {
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
  const { claudeConfigDir, codexConfigDir, claudeDesktopSync } = opts;

  const queueClaudeDesktopSync = (reason: string) => {
    if (!claudeDesktopSync) return;
    void claudeDesktopSync.requestSync(reason).catch(err => {
      app.log.warn({ err }, 'Failed to request Claude Desktop sync');
    });
  };

  // GET /api/sessions
  app.get('/api/sessions', async (_req, reply) => {
    const sessions = await refreshSessionMap(claudeConfigDir, codexConfigDir);
    const grouped = groupSessions(sessions);
    return reply.send(grouped);
  });

  // GET /api/sessions/claude/repair-scan
  app.get('/api/sessions/claude/repair-scan', async (_req, reply) => {
    const issues = await scanClaudeRepairIssues(claudeConfigDir);
    return reply.send(issues);
  });

  // POST /api/sessions/claude/repair-all
  app.post('/api/sessions/claude/repair-all', async (_req, reply) => {
    const body = _req.body as { backup?: boolean } | undefined;
    const issues = await scanClaudeRepairIssues(claudeConfigDir);
    const results = [];

    for (const issue of issues.filter(issue => issue.repairable)) {
      try {
        results.push(await repairClaudeSessionFile(issue.filePath, {
          configDir: claudeConfigDir,
          backup: body?.backup ?? false,
        }));
      } catch (err) {
        results.push({
          ok: false,
          filePath: issue.filePath,
          mainNodes: 0,
          relinked: 0,
          inserted: 0,
          droppedOrphans: 0,
          leaf: null,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    if (results.some(result => result.ok)) {
      queueClaudeDesktopSync('manage:repair-all');
    }

    return reply.send({ results });
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

  // GET /api/sessions/:provider/:id/artifacts — resources owned by one Claude session
  app.get<{
    Params: { provider: string; id: string };
  }>('/api/sessions/:provider/:id/artifacts', async (req, reply) => {
    const { provider, id } = req.params;
    if (provider !== 'claude') {
      return reply.status(400).send({ error: 'Session artifacts are only supported for Claude sessions' });
    }

    let entry = sessionMap.get(sessionKey(provider as Provider, id));
    if (!entry) {
      await refreshSessionMap(claudeConfigDir, codexConfigDir);
      entry = sessionMap.get(sessionKey(provider as Provider, id));
    }
    if (!entry) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    try {
      const artifacts = await listClaudeSessionArtifacts(entry.filePath, {
        configDir: claudeConfigDir,
      });
      return reply.send(artifacts);
    } catch (err) {
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : 'Failed to list session artifacts' });
    }
  });

  // PATCH /api/sessions/:provider/:id — rename
  app.patch<{
    Params: { provider: string; id: string };
    Body: { title: string };
  }>('/api/sessions/:provider/:id', async (req, reply) => {
    const { provider, id } = req.params;
    const { title } = req.body ?? {};

    if (typeof title !== 'string' || !title.trim()) {
      return reply.status(400).send({ error: 'title is required' });
    }

    const entry = sessionMap.get(sessionKey(provider as Provider, id));
    if (!entry) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    try {
      if (entry.provider === 'claude') {
        await renameClaudeSession(entry.filePath, title, claudeConfigDir);
        queueClaudeDesktopSync('manage:rename-session');
      } else {
        await renameCodexSession(entry.filePath, title, codexConfigDir);
      }
      return reply.send({ ok: true });
    } catch (err) {
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // POST /api/sessions/:provider/:id/repair — repair hidden Claude branches
  app.post<{
    Params: { provider: string; id: string };
    Body: { backup?: boolean };
  }>('/api/sessions/:provider/:id/repair', async (req, reply) => {
    const { provider, id } = req.params;

    if (provider !== 'claude') {
      return reply.status(400).send({ error: 'Repair is only supported for Claude sessions' });
    }

    let entry = sessionMap.get(sessionKey(provider as Provider, id));
    if (!entry) {
      await refreshSessionMap(claudeConfigDir, codexConfigDir);
      entry = sessionMap.get(sessionKey(provider as Provider, id));
    }
    if (!entry) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    try {
      const result = await repairClaudeSessionFile(entry.filePath, {
        configDir: claudeConfigDir,
        backup: req.body?.backup ?? false,
      });
      if (result.ok && result.changed) {
        queueClaudeDesktopSync('manage:repair-session');
      }
      return reply.send(result);
    } catch (err) {
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // POST /api/sessions/:provider/:id/messages/delete — delete selected Claude messages safely
  app.post<{
    Params: { provider: string; id: string };
    Body: { messageIds: string[]; backup?: boolean };
  }>('/api/sessions/:provider/:id/messages/delete', async (req, reply) => {
    const { provider, id } = req.params;
    const { messageIds } = req.body ?? {};

    if (provider !== 'claude') {
      return reply
        .status(400)
        .send({ error: 'Message deletion is currently only supported for Claude sessions' });
    }

    if (!Array.isArray(messageIds) || messageIds.some(item => typeof item !== 'string')) {
      return reply.status(400).send({ error: 'messageIds must be a string array' });
    }

    let entry = sessionMap.get(sessionKey(provider as Provider, id));
    if (!entry) {
      await refreshSessionMap(claudeConfigDir, codexConfigDir);
      entry = sessionMap.get(sessionKey(provider as Provider, id));
    }
    if (!entry) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    try {
      const result = await deleteClaudeSessionMessages(entry.filePath, messageIds, {
        configDir: claudeConfigDir,
        backup: req.body?.backup ?? false,
      });
      if (result.ok) {
        queueClaudeDesktopSync('manage:delete-messages');
      }
      return reply.send(result);
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
        await withClaudeJsonlWriteLock(async () => {
          await deleteClaudeSession(entry.filePath, claudeConfigDir);
          if (claudeDesktopSync) {
            await recordCliSessionDeleted({
              claudeHome: claudeConfigDir,
              sessionId: id,
            });
          }
        });
        queueClaudeDesktopSync('manage:delete-session');
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
    let deletedClaudeSession = false;

    for (const { provider, id } of ids) {
      const entry = sessionMap.get(sessionKey(provider as Provider, id));
      if (!entry) {
        results.push({ provider, id, ok: false, error: 'Session not found' });
        continue;
      }

      try {
        if (entry.provider === 'claude') {
          await withClaudeJsonlWriteLock(async () => {
            await deleteClaudeSession(entry.filePath, claudeConfigDir);
            if (claudeDesktopSync) {
              await recordCliSessionDeleted({
                claudeHome: claudeConfigDir,
                sessionId: id,
              });
            }
          });
          deletedClaudeSession = true;
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

    if (deletedClaudeSession) {
      queueClaudeDesktopSync('manage:batch-delete');
    }

    return reply.send({ results });
  });
};
