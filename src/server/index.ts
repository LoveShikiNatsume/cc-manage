import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { sessionsRoutes } from './routes/sessions.js';
import { memoryRoutes } from './routes/memory.js';
import { usageRoutes } from './routes/usage.js';
import { claudeArtifactsRoutes } from './routes/claude-artifacts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ALLOWED_IPS = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
  '10.195.221.240',
  '::ffff:10.195.221.240',
]);

export async function createServer(opts: { port?: number; host?: string } = {}) {
  const port = opts.port || 3456;
  const host = opts.host || '0.0.0.0';
  const app = Fastify({ logger: true });

  app.addHook('onRequest', async (req, reply) => {
    const ip = req.ip;
    if (!ALLOWED_IPS.has(ip)) {
      reply.status(403).send({ error: 'Forbidden' });
    }
  });

  await app.register(fastifyCors, { origin: true });
  await app.register(sessionsRoutes);
  await app.register(memoryRoutes);
  await app.register(usageRoutes);
  await app.register(claudeArtifactsRoutes);

  // Serve pre-built client from dist/client/ in production
  const clientDir = path.join(__dirname, '..', 'client');
  try {
    await app.register(fastifyStatic, { root: clientDir, prefix: '/', wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  } catch {
    app.log.warn('Client build not found, running in API-only mode');
    app.setNotFoundHandler((_, reply) => reply.status(404).send({ error: 'Not found' }));
  }

  await app.listen({ port, host });
  return app;
}

// Allow direct execution
if (process.argv[1] && (process.argv[1].endsWith('src/server/index.ts') || process.argv[1].endsWith('dist/server/index.js'))) {
  const port = parseInt(process.env.PORT || '3456', 10);
  const host = process.env.HOST || '0.0.0.0';
  createServer({ port, host }).catch(err => { console.error(err); process.exit(1); });
}
