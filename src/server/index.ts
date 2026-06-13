import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { sessionsRoutes } from './routes/sessions.js';
import { memoryRoutes } from './routes/memory.js';
import { usageRoutes } from './routes/usage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createServer(opts: { port?: number } = {}) {
  const port = opts.port || 3456;
  const app = Fastify({ logger: true });

  await app.register(fastifyCors, { origin: true });
  await app.register(sessionsRoutes);
  await app.register(memoryRoutes);
  await app.register(usageRoutes);

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

  await app.listen({ port, host: '127.0.0.1' });
  return app;
}

// Allow direct execution
if (process.argv[1] && (process.argv[1].endsWith('src/server/index.ts') || process.argv[1].endsWith('dist/server/index.js'))) {
  const port = parseInt(process.env.PORT || '3456', 10);
  createServer({ port }).catch(err => { console.error(err); process.exit(1); });
}
