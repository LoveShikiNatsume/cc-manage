import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  deleteClaudeArtifact,
  listClaudeArtifacts,
  readClaudeArtifactContent,
} from '../src/server/services/claude-artifacts.js';

let tmpDir: string;
let configDir: string;
let backupFile: string;
let planFile: string;
let sessionFile: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-artifacts-test-'));
  configDir = tmpDir;

  const projectDir = path.join(configDir, 'projects', 'sample-project');
  const sidecarDir = path.join(projectDir, 'session-001');
  await fs.mkdir(path.join(sidecarDir, 'subagents'), { recursive: true });
  await fs.mkdir(path.join(sidecarDir, 'tool-results'), { recursive: true });
  await fs.mkdir(path.join(configDir, 'plans'), { recursive: true });
  await fs.mkdir(path.join(configDir, 'backups'), { recursive: true });

  sessionFile = path.join(projectDir, 'session-001.jsonl');
  backupFile = `${sessionFile}.bak`;
  planFile = path.join(configDir, 'plans', 'daily-plan.md');

  await fs.writeFile(sessionFile, '{"type":"queue-operation"}\n', 'utf-8');
  await fs.writeFile(backupFile, '{"type":"backup"}\n', 'utf-8');
  await fs.writeFile(path.join(sidecarDir, 'subagents', 'agent-1.meta.json'), '{"name":"agent"}\n', 'utf-8');
  await fs.writeFile(path.join(sidecarDir, 'tool-results', 'result.txt'), 'tool output', 'utf-8');
  await fs.writeFile(planFile, '# Plan\n\n- ship it\n', 'utf-8');
  await fs.writeFile(path.join(configDir, 'backups', '.claude.json.backup.2026'), '{}\n', 'utf-8');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('listClaudeArtifacts', () => {
  it('lists Claude sidecars, plans, and deletable backups', async () => {
    const overview = await listClaudeArtifacts(configDir);
    const groups = new Map(overview.groups.map(group => [group.id, group]));

    expect(groups.get('session-backups')?.items[0]).toMatchObject({
      kind: 'session-backup',
      deletable: true,
      sessionId: 'session-001',
    });
    expect(groups.get('subagents')?.items[0]).toMatchObject({
      kind: 'subagent',
      deletable: false,
    });
    expect(groups.get('tool-results')?.items[0]).toMatchObject({
      kind: 'tool-result',
    });
    expect(groups.get('plans')?.items[0]).toMatchObject({
      kind: 'plan',
      contentType: 'markdown',
    });
    expect(groups.get('root-config')?.items.some(item => item.kind === 'config-backup')).toBe(true);
  });
});

describe('readClaudeArtifactContent', () => {
  it('renders text and markdown artifacts', async () => {
    const content = await readClaudeArtifactContent(planFile, { configDir });

    expect(content.encoding).toBe('utf-8');
    expect(content.contentType).toBe('markdown');
    expect(content.content).toContain('ship it');
  });

  it('rejects paths outside the Claude config directory', async () => {
    await expect(
      readClaudeArtifactContent(path.join(tmpDir, '..', 'outside.txt'), { configDir }),
    ).rejects.toThrow(/outside/);
  });
});

describe('deleteClaudeArtifact', () => {
  it('deletes backup artifacts', async () => {
    const result = await deleteClaudeArtifact(backupFile, { configDir });

    expect(result.ok).toBe(true);
    await expect(fs.access(backupFile)).rejects.toThrow();
  });

  it('does not delete original session JSONL files', async () => {
    await expect(deleteClaudeArtifact(sessionFile, { configDir })).rejects.toThrow(/backup/);
    await expect(fs.access(sessionFile)).resolves.toBeUndefined();
  });
});
