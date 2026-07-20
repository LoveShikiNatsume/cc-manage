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

  it('does not append subscription visibility mirrors into the Claude Code JSONL', async () => {
    const fixture = await makeFixture();
    const jsonlPath = path.join(fixture.projectDir, 'session-api.jsonl');
    await writeCliSession(jsonlPath, 'session-api', 'claude-desktop-3p');
    await writeDesktopTemplate(fixture.scopeDir);
    const before = await fs.readFile(jsonlPath, 'utf8');

    const result = await runSync({ ...fixture, target: 'subscription-view', apply: true });

    expect(result.written).not.toContain(jsonlPath);
    await expect(fs.readFile(jsonlPath, 'utf8')).resolves.toBe(before);
    expect(result.backupDir).toBeTruthy();
  });

  it('does not fan a new session out to an account Desktop has not reported as active', async () => {
    const fixture = await makeFixture();
    await writeDesktopTemplate(fixture.scopeDir);
    const scopeDirB = path.join(fixture.desktopRoot, 'claude-code-sessions', 'account-b', 'org-b');
    await fs.mkdir(scopeDirB, { recursive: true });
    await fs.writeFile(
      path.join(scopeDirB, 'local_existing_b.json'),
      `${JSON.stringify(
        {
          sessionId: 'local_existing_b',
          cliSessionId: 'session-existing-b',
          cwd: 'C:/Code/demo',
          originCwd: 'C:/Code/demo',
          createdAt: 1780000000000,
          lastActivityAt: 1780000000000,
          isArchived: false,
          completedTurns: 1,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    await writeCliSession(
      path.join(fixture.projectDir, 'session-missing.jsonl'),
      'session-missing',
      'claude-desktop',
    );

    // No lastKnownAccountUuid in config.json here -- with no explicit signal,
    // sync should fall back to the single most-recently-active scope, not
    // silently write into every account it happens to find.
    const result = await runSync({ ...fixture, target: 'api-view', apply: true });

    expect(result.written).toHaveLength(1);
    expect(result.written[0].startsWith(scopeDirB)).toBe(false);
  });

  it('targets the account Desktop reports as currently active (config.json lastKnownAccountUuid), even if another account has a more recent session', async () => {
    const fixture = await makeFixture();
    await writeDesktopTemplate(fixture.scopeDir); // account-a/org-a, lastActivityAt 1780000000000
    const scopeDirB = path.join(fixture.desktopRoot, 'claude-code-sessions', 'account-b', 'org-b');
    await fs.mkdir(scopeDirB, { recursive: true });
    await fs.writeFile(
      path.join(scopeDirB, 'local_existing_b.json'),
      `${JSON.stringify(
        {
          sessionId: 'local_existing_b',
          cliSessionId: 'session-existing-b',
          cwd: 'C:/Code/demo',
          originCwd: 'C:/Code/demo',
          createdAt: 1790000000000,
          lastActivityAt: 1790000000000, // more recent than account-a's session
          isArchived: false,
          completedTurns: 1,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    // Desktop's own config says account-a is the one actually in use, despite
    // account-b having the more recently touched session file.
    await fs.writeFile(
      path.join(fixture.desktopRoot, 'config.json'),
      `${JSON.stringify({ lastKnownAccountUuid: 'account-a' }, null, 2)}\n`,
      'utf8',
    );
    await writeCliSession(
      path.join(fixture.projectDir, 'session-missing.jsonl'),
      'session-missing',
      'claude-desktop',
    );

    const result = await runSync({ ...fixture, target: 'api-view', apply: true });

    expect(result.written).toHaveLength(1);
    expect(result.written[0].startsWith(fixture.scopeDir)).toBe(true);
    const written = JSON.parse(await fs.readFile(result.written[0], 'utf8'));
    expect(written.cliSessionId).toBe('session-missing');
  });

  it('backfills a fresh copy into the active account when the only existing copy sits in an abandoned account', async () => {
    const fixture = await makeFixture(); // account-a/org-a is the active account below
    await writeDesktopTemplate(fixture.scopeDir); // active account already has at least one real session
    const scopeDirB = path.join(fixture.desktopRoot, 'claude-code-sessions', 'account-b', 'org-b');
    await fs.mkdir(scopeDirB, { recursive: true });
    const staleRaw = {
      sessionId: 'local_stale_in_b',
      cliSessionId: 'session-stranded',
      cwd: 'C:/Code/demo',
      originCwd: 'C:/Code/demo',
      createdAt: 1780000000000,
      lastActivityAt: 1780000000000,
      isArchived: false,
      completedTurns: 1,
    };
    await fs.writeFile(
      path.join(scopeDirB, 'local_stale_in_b.json'),
      `${JSON.stringify(staleRaw, null, 2)}\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(fixture.desktopRoot, 'config.json'),
      `${JSON.stringify({ lastKnownAccountUuid: 'account-a' }, null, 2)}\n`,
      'utf8',
    );
    await writeCliSession(
      path.join(fixture.projectDir, 'session-stranded.jsonl'),
      'session-stranded',
      'claude-desktop',
    );

    const result = await runSync({ ...fixture, target: 'api-view', apply: true });

    // A fresh copy lands in the active account...
    expect(result.written).toHaveLength(1);
    expect(result.written[0].startsWith(fixture.scopeDir)).toBe(true);
    const written = JSON.parse(await fs.readFile(result.written[0], 'utf8'));
    expect(written.cliSessionId).toBe('session-stranded');

    // ...and the stale copy in the abandoned account is left completely untouched.
    const stale = JSON.parse(await fs.readFile(path.join(scopeDirB, 'local_stale_in_b.json'), 'utf8'));
    expect(stale).toEqual(staleRaw);
  });
});
