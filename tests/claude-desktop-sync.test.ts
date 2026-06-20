import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runSync } from '../src/server/services/claude-desktop-sync/sync.js';

const tempRoots: string[] = [];

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-manage-desktop-sync-'));
  tempRoots.push(root);
  const claudeHome = path.join(root, '.claude');
  const desktopRoot = path.join(root, 'Claude-3p');
  const statePath = path.join(root, '.claude.json');
  const projectDir = path.join(claudeHome, 'projects', 'C--Code-demo');
  const scopeDir = path.join(desktopRoot, 'claude-code-sessions', 'account-a', 'org-a');
  await fs.mkdir(projectDir, { recursive: true });
  await fs.mkdir(scopeDir, { recursive: true });
  await fs.writeFile(path.join(desktopRoot, 'config.json'), '{}\n', 'utf8');
  await fs.writeFile(statePath, '{"projects":{}}\n', 'utf8');
  return { root, claudeHome, desktopRoot, statePath, projectDir, scopeDir };
}

async function writeCliSession(
  filePath: string,
  sessionId: string,
  entrypoint: 'claude-desktop' | 'claude-desktop-3p',
) {
  const cwd = 'C:/Code/demo';
  const records = [
    { type: 'queue-operation', operation: 'init', timestamp: '2026-06-11T00:00:00.000Z', sessionId },
    {
      type: 'user',
      timestamp: '2026-06-11T00:00:01.000Z',
      sessionId,
      cwd,
      message: { role: 'user', content: 'continue the work' },
      entrypoint,
    },
    {
      type: 'assistant',
      timestamp: '2026-06-11T00:00:02.000Z',
      sessionId,
      cwd,
      message: { role: 'assistant', model: 'claude-sonnet-4-6', content: [] },
    },
  ];
  await fs.writeFile(filePath, `${records.map(record => JSON.stringify(record)).join('\n')}\n`, 'utf8');
}

async function writeDesktopTemplate(scopeDir: string) {
  const metadata = {
    sessionId: 'local_existing',
    cliSessionId: 'session-existing',
    cwd: 'C:/Code/demo',
    originCwd: 'C:/Code/demo',
    createdAt: 1780000000000,
    lastActivityAt: 1780000000000,
    isArchived: false,
    completedTurns: 1,
  };
  await fs.writeFile(
    path.join(scopeDir, 'local_existing.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
    'utf8',
  );
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe('Claude Desktop sync', () => {
  it('backs up and creates Desktop metadata for a CLI session', async () => {
    const fixture = await makeFixture();
    await writeCliSession(
      path.join(fixture.projectDir, 'session-missing.jsonl'),
      'session-missing',
      'claude-desktop',
    );
    await writeDesktopTemplate(fixture.scopeDir);

    const result = await runSync({ ...fixture, target: 'api-view', apply: true });

    expect(result.written).toHaveLength(1);
    const written = JSON.parse(await fs.readFile(result.written[0], 'utf8'));
    expect(written.cliSessionId).toBe('session-missing');
    expect(written.titleSource).toBe('imported');
    await expect(fs.access(path.join(result.backupDir, 'metadata.json'))).resolves.toBeUndefined();
  });

  it('backs up JSONL before appending a subscription visibility mirror', async () => {
    const fixture = await makeFixture();
    const jsonlPath = path.join(fixture.projectDir, 'session-api.jsonl');
    await writeCliSession(jsonlPath, 'session-api', 'claude-desktop-3p');
    await writeDesktopTemplate(fixture.scopeDir);

    const result = await runSync({ ...fixture, target: 'subscription-view', apply: true });

    expect(result.written).toContain(jsonlPath);
    const text = await fs.readFile(jsonlPath, 'utf8');
    expect(text).toContain('"entrypoint":"claude-desktop"');
    expect(text).toContain('"visibilityMirror"');
    expect(result.backupDir).toBeTruthy();
  });
});
