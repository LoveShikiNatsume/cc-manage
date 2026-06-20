import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import Fastify from 'fastify';
import { sessionsRoutes } from '../../src/server/routes/sessions.js';

// Minimal valid Claude JSONL session
const CLAUDE_JSONL = [
  '{"type":"queue-operation","operation":"enqueue","timestamp":"2026-06-01T02:40:05.900Z","sessionId":"session-claude-001"}',
  '{"parentUuid":null,"isSidechain":false,"type":"user","message":{"role":"user","content":[{"type":"text","text":"Hello from test"}]},"cwd":"/home/user/testproject","timestamp":"2026-06-01T02:40:06.000Z","sessionId":"session-claude-001"}',
  '{"parentUuid":"abc","isSidechain":false,"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hi there!"}]},"timestamp":"2026-06-01T02:41:00.000Z"}',
].join('\n') + '\n';

// Minimal valid Codex JSONL session
const CODEX_JSONL = [
  '{"timestamp":"2026-06-04T05:38:46.641Z","type":"session_meta","payload":{"id":"codex-session-001","timestamp":"2026-06-04T05:38:46.517Z","cwd":"/home/user/codexproject","source":"vscode","cli_version":"0.133.0"}}',
  '{"timestamp":"2026-06-04T05:39:02.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Fix the bug"}]}}',
  '{"timestamp":"2026-06-04T05:39:10.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Fixed!"}]}}',
].join('\n') + '\n';

let tmpDir: string;
let claudeConfigDir: string;
let codexConfigDir: string;
let claudeSessionFile: string;
let codexSessionFile: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'routes-sessions-test-'));

  // Setup Claude config dir: ~/.claude/projects/<project>/<session>.jsonl
  claudeConfigDir = path.join(tmpDir, 'claude');
  const claudeProjectDir = path.join(claudeConfigDir, 'projects', 'testproject');
  await fs.mkdir(claudeProjectDir, { recursive: true });

  claudeSessionFile = path.join(claudeProjectDir, 'session-claude-001.jsonl');
  await fs.writeFile(claudeSessionFile, CLAUDE_JSONL, 'utf-8');
  const claudeSidecarDir = path.join(claudeProjectDir, 'session-claude-001');
  await fs.mkdir(path.join(claudeSidecarDir, 'subagents'), { recursive: true });
  await fs.mkdir(path.join(claudeSidecarDir, 'tool-results'), { recursive: true });
  await fs.writeFile(
    path.join(claudeSidecarDir, 'subagents', 'agent-test.meta.json'),
    '{"name":"test agent"}\n',
    'utf-8',
  );
  await fs.writeFile(
    path.join(claudeSidecarDir, 'tool-results', 'result.txt'),
    'tool output',
    'utf-8',
  );

  // Setup Codex config dir: ~/.codex/sessions/<session>.jsonl
  codexConfigDir = path.join(tmpDir, 'codex');
  const codexSessionDir = path.join(codexConfigDir, 'sessions');
  await fs.mkdir(codexSessionDir, { recursive: true });

  codexSessionFile = path.join(codexSessionDir, 'codex-session-001.jsonl');
  await fs.writeFile(codexSessionFile, CODEX_JSONL, 'utf-8');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function createApp() {
  const app = Fastify({ logger: false });
  app.register(sessionsRoutes, { claudeConfigDir, codexConfigDir });
  return app;
}

describe('GET /api/sessions', () => {
  it('returns grouped sessions from both providers', async () => {
    const app = createApp();
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/sessions' });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(Array.isArray(body)).toBe(true);

    const claudeGroup = body.find((g: any) => g.provider === 'claude');
    const codexGroup = body.find((g: any) => g.provider === 'codex');

    expect(claudeGroup).toBeDefined();
    expect(codexGroup).toBeDefined();

    expect(claudeGroup.projects.length).toBeGreaterThan(0);
    const claudeProject = claudeGroup.projects[0];
    expect(claudeProject.sessions.length).toBe(1);
    expect(claudeProject.sessions[0].id).toBe('session-claude-001');
    expect(claudeProject.sessions[0].title).toBe('Hello from test');

    await app.close();
  });

  it('returns empty array when no sessions exist', async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'empty-config-'));
    try {
      const app = Fastify({ logger: false });
      app.register(sessionsRoutes, {
        claudeConfigDir: emptyDir,
        codexConfigDir: emptyDir,
      });
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/api/sessions' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);

      await app.close();
    } finally {
      await fs.rm(emptyDir, { recursive: true, force: true });
    }
  });
});

describe('GET /api/sessions/:provider/:id/messages', () => {
  it('returns messages for a Claude session', async () => {
    const app = createApp();
    await app.ready();

    // First populate the session map by listing
    await app.inject({ method: 'GET', url: '/api/sessions' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/claude/session-claude-001/messages',
    });

    expect(res.statusCode).toBe(200);
    const messages = res.json();
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('Hello from test');

    await app.close();
  });

  it('returns messages for a Codex session', async () => {
    const app = createApp();
    await app.ready();

    // First populate the session map by listing
    await app.inject({ method: 'GET', url: '/api/sessions' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/codex/codex-session-001/messages',
    });

    expect(res.statusCode).toBe(200);
    const messages = res.json();
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBeGreaterThan(0);

    await app.close();
  });

  it('returns 404 for unknown session', async () => {
    const app = createApp();
    await app.ready();

    await app.inject({ method: 'GET', url: '/api/sessions' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/claude/nonexistent-session/messages',
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('GET /api/sessions/:provider/:id/artifacts', () => {
  it('returns resources owned by the selected Claude session', async () => {
    const app = createApp();
    await app.ready();
    await app.inject({ method: 'GET', url: '/api/sessions' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/claude/session-claude-001/artifacts',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessionId).toBe('session-claude-001');
    expect(body.totalCount).toBe(2);
    expect(body.groups.find((group: any) => group.id === 'tool-results').items).toHaveLength(1);
    expect(body.groups.find((group: any) => group.id === 'subagents').items).toHaveLength(1);

    await app.close();
  });

  it('rejects session artifacts for non-Claude providers', async () => {
    const app = createApp();
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/codex/codex-session-001/artifacts',
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('PATCH /api/sessions/:provider/:id', () => {
  it('renames a Claude session', async () => {
    const app = createApp();
    await app.ready();

    // Populate session map
    await app.inject({ method: 'GET', url: '/api/sessions' });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/sessions/claude/session-claude-001',
      payload: { title: 'My Renamed Session' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    // Verify the rename was applied by re-fetching sessions
    const listRes = await app.inject({ method: 'GET', url: '/api/sessions' });
    const body = listRes.json();
    const claudeGroup = body.find((g: any) => g.provider === 'claude');
    const session = claudeGroup.projects[0].sessions[0];
    expect(session.title).toBe('My Renamed Session');

    await app.close();
  });

  it('renames a Codex session', async () => {
    const app = createApp();
    await app.ready();

    await app.inject({ method: 'GET', url: '/api/sessions' });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/sessions/codex/codex-session-001',
      payload: { title: 'New Title' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const listRes = await app.inject({ method: 'GET', url: '/api/sessions' });
    const body = listRes.json();
    const codexGroup = body.find((g: any) => g.provider === 'codex');
    const session = codexGroup.projects[0].sessions[0];
    expect(session.title).toBe('New Title');

    const lines = (await fs.readFile(codexSessionFile, 'utf-8')).split('\n').filter(Boolean);
    const lastLine = JSON.parse(lines[lines.length - 1]);
    expect(lastLine.type).toBe('event_msg');
    expect(lastLine.payload.type).toBe('thread_name_updated');
    expect(lastLine.payload.thread_name).toBe('New Title');

    await app.close();
  });

  it('returns 400 when title is missing', async () => {
    const app = createApp();
    await app.ready();

    await app.inject({ method: 'GET', url: '/api/sessions' });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/sessions/claude/session-claude-001',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns 404 for unknown session', async () => {
    const app = createApp();
    await app.ready();

    await app.inject({ method: 'GET', url: '/api/sessions' });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/sessions/claude/unknown-session',
      payload: { title: 'Title' },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('DELETE /api/sessions/:provider/:id', () => {
  it('deletes a Claude session', async () => {
    const app = createApp();
    await app.ready();

    // Populate session map
    await app.inject({ method: 'GET', url: '/api/sessions' });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/sessions/claude/session-claude-001',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    // File should be gone
    await expect(fs.access(claudeSessionFile)).rejects.toThrow();

    await app.close();
  });

  it('deletes a Codex session', async () => {
    const app = createApp();
    await app.ready();

    await app.inject({ method: 'GET', url: '/api/sessions' });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/sessions/codex/codex-session-001',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    await expect(fs.access(codexSessionFile)).rejects.toThrow();

    await app.close();
  });

  it('returns 404 for unknown session', async () => {
    const app = createApp();
    await app.ready();

    await app.inject({ method: 'GET', url: '/api/sessions' });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/sessions/claude/nonexistent',
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('POST /api/sessions/batch-delete', () => {
  it('deletes multiple sessions in one request', async () => {
    const app = createApp();
    await app.ready();

    // Add a second Claude session
    const projectDir = path.join(claudeConfigDir, 'projects', 'testproject');
    const secondSessionFile = path.join(projectDir, 'session-claude-002.jsonl');
    const secondJsonl = [
      '{"type":"queue-operation","operation":"enqueue","timestamp":"2026-06-02T10:00:00.000Z","sessionId":"session-claude-002"}',
      '{"parentUuid":null,"isSidechain":false,"type":"user","message":{"role":"user","content":[{"type":"text","text":"Second session"}]},"cwd":"/home/user/testproject","timestamp":"2026-06-02T10:00:01.000Z","sessionId":"session-claude-002"}',
    ].join('\n') + '\n';
    await fs.writeFile(secondSessionFile, secondJsonl, 'utf-8');

    // Populate session map
    await app.inject({ method: 'GET', url: '/api/sessions' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions/batch-delete',
      payload: {
        ids: [
          { provider: 'claude', id: 'session-claude-001' },
          { provider: 'claude', id: 'session-claude-002' },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toHaveLength(2);
    expect(body.results.every((r: any) => r.ok === true)).toBe(true);

    await expect(fs.access(claudeSessionFile)).rejects.toThrow();
    await expect(fs.access(secondSessionFile)).rejects.toThrow();

    await app.close();
  });

  it('handles mixed success/failure in batch delete', async () => {
    const app = createApp();
    await app.ready();

    await app.inject({ method: 'GET', url: '/api/sessions' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions/batch-delete',
      payload: {
        ids: [
          { provider: 'claude', id: 'session-claude-001' },
          { provider: 'claude', id: 'nonexistent-session' },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toHaveLength(2);

    const success = body.results.find((r: any) => r.id === 'session-claude-001');
    const failure = body.results.find((r: any) => r.id === 'nonexistent-session');
    expect(success.ok).toBe(true);
    expect(failure.ok).toBe(false);

    await app.close();
  });

  it('returns 400 when ids is missing', async () => {
    const app = createApp();
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions/batch-delete',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
