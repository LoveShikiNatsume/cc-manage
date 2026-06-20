import type { FastifyPluginAsync } from 'fastify';
import type { ClaudeDesktopAutoSyncController } from '../services/claude-desktop-sync/background.js';

interface ClaudeDesktopSyncRouteOptions {
  claudeDesktopSync?: ClaudeDesktopAutoSyncController;
}

export const claudeDesktopSyncRoutes: FastifyPluginAsync<ClaudeDesktopSyncRouteOptions> = async (
  app,
  opts,
) => {
  app.get('/api/claude-desktop-sync', async (_req, reply) => {
    if (!opts.claudeDesktopSync) {
      return reply.send({
        enabled: false,
        started: false,
        stopped: false,
        running: false,
        pending: false,
        claudeRunning: null,
        pass: 0,
        environment: null,
        lastRequestedAt: null,
        lastRequestReason: null,
        lastRunAt: null,
        lastError: null,
        lastSummary: null,
      });
    }

    return reply.send(opts.claudeDesktopSync.getStatus());
  });

  app.post('/api/claude-desktop-sync/run', async (_req, reply) => {
    if (!opts.claudeDesktopSync) {
      return reply.status(404).send({ error: 'Claude Desktop sync is not available' });
    }

    const status = await opts.claudeDesktopSync.requestSync('manual');
    return reply.send(status);
  });
};
