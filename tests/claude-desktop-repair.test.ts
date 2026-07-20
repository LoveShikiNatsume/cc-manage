import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyCliSessionIdRepairs,
  planCliSessionIdRepairs,
} from '../src/server/services/claude-desktop-sync/repair.js';

function desktopSession(overrides: Record<string, unknown> = {}) {
  return {
    filePath: 'C:/fake/local_broken.json',
    cliSessionId: null,
    cwd: 'C:/Code/demo',
    originCwd: 'C:/Code/demo',
    createdAtMs: 1_780_000_000_000,
    title: 'Broken session',
    raw: { sessionId: 'local_broken', cwd: 'C:/Code/demo' },
    ...overrides,
  };
}

function cliSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'cli-session-a',
    cwd: 'C:/Code/demo',
    createdAtMs: 1_780_000_000_000,
    ...overrides,
  };
}

describe('planCliSessionIdRepairs', () => {
  it('matches a broken Desktop session to the CLI session with the same cwd and creation time', () => {
    const plan = planCliSessionIdRepairs({
      desktopSessions: [desktopSession()],
      cliSessions: [cliSession()],
    });
    expect(plan.repairs).toHaveLength(1);
    expect(plan.repairs[0].cliSessionId).toBe('cli-session-a');
    expect(plan.unresolved).toHaveLength(0);
  });

  it('does not touch Desktop sessions that already have a cliSessionId', () => {
    const plan = planCliSessionIdRepairs({
      desktopSessions: [desktopSession({ cliSessionId: 'already-set' })],
      cliSessions: [cliSession()],
    });
    expect(plan.repairs).toHaveLength(0);
    expect(plan.unresolved).toHaveLength(0);
  });

  it('leaves a session unresolved when no CLI session matches cwd', () => {
    const plan = planCliSessionIdRepairs({
      desktopSessions: [desktopSession({ cwd: 'C:/Code/other' })],
      cliSessions: [cliSession()],
    });
    expect(plan.repairs).toHaveLength(0);
    expect(plan.unresolved).toHaveLength(1);
    expect(plan.unresolved[0].reason).toMatch(/no cli session/i);
  });

  it('leaves a session unresolved when creation times drift too far apart', () => {
    const plan = planCliSessionIdRepairs({
      desktopSessions: [desktopSession({ createdAtMs: 1_780_000_000_000 })],
      cliSessions: [cliSession({ createdAtMs: 1_780_000_000_000 + 60 * 60 * 1000 })],
    });
    expect(plan.repairs).toHaveLength(0);
    expect(plan.unresolved).toHaveLength(1);
  });

  it('refuses to guess when two CLI sessions match equally well', () => {
    const plan = planCliSessionIdRepairs({
      desktopSessions: [desktopSession()],
      cliSessions: [
        cliSession({ sessionId: 'cli-a', createdAtMs: 1_780_000_000_000 + 1000 }),
        cliSession({ sessionId: 'cli-b', createdAtMs: 1_780_000_000_000 - 1000 }),
      ],
    });
    expect(plan.repairs).toHaveLength(0);
    expect(plan.unresolved).toHaveLength(1);
    expect(plan.unresolved[0].reason).toMatch(/multiple/i);
  });

  it('does not assign the same CLI session to two different broken Desktop files', () => {
    const plan = planCliSessionIdRepairs({
      desktopSessions: [
        desktopSession({ filePath: 'C:/fake/local_1.json' }),
        desktopSession({ filePath: 'C:/fake/local_2.json' }),
      ],
      cliSessions: [cliSession()],
    });
    expect(plan.repairs).toHaveLength(1);
    expect(plan.unresolved).toHaveLength(1);
  });

  it('does not offer a CLI session that is already claimed by a healthy Desktop session', () => {
    const plan = planCliSessionIdRepairs({
      desktopSessions: [
        desktopSession({ filePath: 'C:/fake/local_healthy.json', cliSessionId: 'cli-session-a' }),
        desktopSession({ filePath: 'C:/fake/local_broken.json' }),
      ],
      cliSessions: [cliSession()],
    });
    expect(plan.repairs).toHaveLength(0);
    expect(plan.unresolved).toHaveLength(1);
  });
});

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe('applyCliSessionIdRepairs (filesystem)', () => {
  it('backs up and rewrites a Desktop session file that lost its cliSessionId', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-manage-repair-'));
    tempRoots.push(root);
    const claudeHome = path.join(root, '.claude');
    const scopeDir = path.join(root, 'Claude', 'claude-code-sessions', 'org-a', 'user-a');
    await fs.mkdir(scopeDir, { recursive: true });

    const filePath = path.join(scopeDir, 'local_broken.json');
    const brokenRaw = {
      sessionId: 'local_broken',
      cwd: 'C:/Code/demo',
      originCwd: 'C:/Code/demo',
      createdAt: 1780000000000,
      lastActivityAt: 1780000000000,
      isArchived: false,
      title: 'Kept title',
      completedTurns: 3,
    };
    await fs.writeFile(filePath, `${JSON.stringify(brokenRaw, null, 2)}\n`, 'utf8');

    const result = await applyCliSessionIdRepairs({
      claudeHome,
      desktopSessions: [
        {
          filePath,
          cliSessionId: null,
          cwd: 'C:/Code/demo',
          originCwd: 'C:/Code/demo',
          createdAtMs: 1780000000000,
          title: 'Kept title',
          raw: brokenRaw,
        },
      ],
      cliSessions: [
        {
          sessionId: 'cli-session-real',
          cwd: 'C:/Code/demo',
          createdAtMs: 1780000000000,
        },
      ],
    });

    expect(result.repaired).toHaveLength(1);
    expect(result.unresolved).toHaveLength(0);

    const after = JSON.parse(await fs.readFile(filePath, 'utf8'));
    expect(after.cliSessionId).toBe('cli-session-real');
    expect(after.title).toBe('Kept title');

    const backedUp = JSON.parse(await fs.readFile(result.repaired[0].backupPath, 'utf8'));
    expect(backedUp.cliSessionId).toBeUndefined();
  });
});
