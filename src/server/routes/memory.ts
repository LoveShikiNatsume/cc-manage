import path from 'path';
import type { FastifyPluginAsync } from 'fastify';
import {
  listMemoryProjects,
  listMemories,
  readMemory,
  createMemory,
  updateMemory,
  deleteMemory,
} from '../services/memory-manager.js';
import { listCodexMemories } from '../services/codex-memory.js';

interface MemoryPluginOptions {
  claudeConfigDir?: string;
  codexMemoryDbPath?: string;
}

export const memoryRoutes: FastifyPluginAsync<MemoryPluginOptions> = async (
  app,
  opts,
) => {
  const { claudeConfigDir, codexMemoryDbPath } = opts;

  // GET /api/memory/claude — list all memory projects
  app.get('/api/memory/claude', async (_req, reply) => {
    const projects = await listMemoryProjects(claudeConfigDir);
    return reply.send(projects);
  });

  // GET /api/memory/claude/:project — list memories in a project
  app.get<{
    Params: { project: string };
  }>('/api/memory/claude/:project', async (req, reply) => {
    const { project } = req.params;
    const projects = await listMemoryProjects(claudeConfigDir);
    const found = projects.find(p => p.project === project);
    if (!found) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const memDir = path.join(found.projectDir, 'memory');
    const memories = await listMemories(memDir, claudeConfigDir);
    return reply.send(memories);
  });

  // GET /api/memory/claude/:project/:file — read a memory file
  app.get<{
    Params: { project: string; file: string };
  }>('/api/memory/claude/:project/:file', async (req, reply) => {
    const { project, file } = req.params;
    const projects = await listMemoryProjects(claudeConfigDir);
    const found = projects.find(p => p.project === project);
    if (!found) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const filePath = path.join(found.projectDir, 'memory', file);
    try {
      const content = await readMemory(filePath, claudeConfigDir);
      return reply.send(content);
    } catch (err) {
      return reply
        .status(404)
        .send({ error: err instanceof Error ? err.message : 'Memory file not found' });
    }
  });

  // POST /api/memory/claude/:project — create a memory file
  app.post<{
    Params: { project: string };
    Body: {
      filename: string;
      name: string;
      description: string;
      type: string;
      body: string;
    };
  }>('/api/memory/claude/:project', async (req, reply) => {
    const { project } = req.params;
    const { filename, name, description, type, body } = req.body ?? {};

    if (!filename || !name) {
      return reply.status(400).send({ error: 'filename and name are required' });
    }

    const projects = await listMemoryProjects(claudeConfigDir);
    const found = projects.find(p => p.project === project);
    if (!found) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const memDir = path.join(found.projectDir, 'memory');
    try {
      await createMemory(
        memDir,
        filename,
        { name, description: description ?? '', type: type ?? '' },
        body ?? '',
        claudeConfigDir,
      );
      return reply.status(201).send({ ok: true });
    } catch (err) {
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // PUT /api/memory/claude/:project/:file — update a memory file
  app.put<{
    Params: { project: string; file: string };
    Body: { content: string };
  }>('/api/memory/claude/:project/:file', async (req, reply) => {
    const { project, file } = req.params;
    const { content } = req.body ?? {};

    if (typeof content !== 'string') {
      return reply.status(400).send({ error: 'content is required' });
    }

    const projects = await listMemoryProjects(claudeConfigDir);
    const found = projects.find(p => p.project === project);
    if (!found) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const filePath = path.join(found.projectDir, 'memory', file);
    try {
      await updateMemory(filePath, content, claudeConfigDir);
      return reply.send({ ok: true });
    } catch (err) {
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // DELETE /api/memory/claude/:project/:file — delete a memory file
  app.delete<{
    Params: { project: string; file: string };
  }>('/api/memory/claude/:project/:file', async (req, reply) => {
    const { project, file } = req.params;
    const projects = await listMemoryProjects(claudeConfigDir);
    const found = projects.find(p => p.project === project);
    if (!found) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const memDir = path.join(found.projectDir, 'memory');
    const filePath = path.join(memDir, file);
    try {
      await deleteMemory(filePath, memDir, claudeConfigDir);
      return reply.send({ ok: true });
    } catch (err) {
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // GET /api/memory/codex — list codex memories
  app.get('/api/memory/codex', async (_req, reply) => {
    const memories = listCodexMemories(codexMemoryDbPath);
    return reply.send(memories);
  });
};
