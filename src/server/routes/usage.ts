import type { FastifyPluginAsync } from 'fastify';
import type { Provider } from '@shared/types.js';
import { fetchAllUsage, fetchProviderUsage } from '../services/usage-fetcher.js';

export const usageRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/usage — fetch all provider usage
  app.get('/api/usage', async (_req, reply) => {
    const usage = await fetchAllUsage();
    return reply.send(usage);
  });

  // GET /api/usage/:provider — fetch usage for a specific provider
  app.get<{
    Params: { provider: string };
  }>('/api/usage/:provider', async (req, reply) => {
    const { provider } = req.params;

    if (provider !== 'claude' && provider !== 'codex') {
      return reply.status(400).send({ error: 'Provider must be "claude" or "codex"' });
    }

    const result = await fetchProviderUsage(provider as Provider);
    return reply.send(result);
  });
};
