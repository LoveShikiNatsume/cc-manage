import type { FastifyPluginAsync } from 'fastify';
import {
  deleteClaudeArtifact,
  listClaudeArtifacts,
  readClaudeArtifactContent,
} from '../services/claude-artifacts.js';

interface ClaudeArtifactsPluginOptions {
  claudeConfigDir?: string;
}

export const claudeArtifactsRoutes: FastifyPluginAsync<ClaudeArtifactsPluginOptions> = async (
  app,
  opts,
) => {
  const { claudeConfigDir } = opts;

  app.get('/api/claude-artifacts', async (_req, reply) => {
    const overview = await listClaudeArtifacts(claudeConfigDir);
    return reply.send(overview);
  });

  app.get<{
    Querystring: { path?: string };
  }>('/api/claude-artifacts/content', async (req, reply) => {
    const filePath = req.query.path;
    if (!filePath) {
      return reply.status(400).send({ error: 'path is required' });
    }

    try {
      const content = await readClaudeArtifactContent(filePath, { configDir: claudeConfigDir });
      return reply.send(content);
    } catch (err) {
      return reply
        .status(404)
        .send({ error: err instanceof Error ? err.message : 'Artifact not found' });
    }
  });

  app.delete<{
    Body: { path?: string };
  }>('/api/claude-artifacts', async (req, reply) => {
    const filePath = req.body?.path;
    if (!filePath) {
      return reply.status(400).send({ error: 'path is required' });
    }

    try {
      const result = await deleteClaudeArtifact(filePath, { configDir: claudeConfigDir });
      return reply.send(result);
    } catch (err) {
      return reply
        .status(400)
        .send({ error: err instanceof Error ? err.message : 'Delete failed' });
    }
  });
};
