import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  deleteClaudeSessionMessages,
  repairClaudeSessionFile,
  scanClaudeRepairFile,
  scanClaudeRepairIssues,
} from '../src/server/services/claude-repair.js';

let tmpDir: string;
let configDir: string;
let projectDir: string;
let sessionFile: string;

const BRANCHED_JSONL = [
  '{"type":"queue-operation","operation":"enqueue","timestamp":"2026-06-01T02:40:05.900Z","sessionId":"repair-session-001"}',
  '{"uuid":"u1","parentUuid":null,"isSidechain":false,"type":"user","message":{"role":"user","content":[{"type":"text","text":"Start"}]},"cwd":"/home/user/repairproj","timestamp":"2026-06-01T02:40:06.000Z","sessionId":"repair-session-001"}',
  '{"uuid":"a1","parentUuid":"u1","isSidechain":false,"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"First branch"}]},"timestamp":"2026-06-01T02:41:00.000Z","sessionId":"repair-session-001"}',
  '{"uuid":"a2","parentUuid":"u1","isSidechain":false,"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Second branch"}]},"timestamp":"2026-06-01T02:42:00.000Z","sessionId":"repair-session-001"}',
  '{"type":"last-prompt","leafUuid":"a2"}',
].join('\n') + '\n';

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-repair-test-'));
  configDir = tmpDir;
  projectDir = path.join(configDir, 'projects', 'repairproj');
  await fs.mkdir(projectDir, { recursive: true });
  sessionFile = path.join(projectDir, 'repair-session-001.jsonl');
  await fs.writeFile(sessionFile, BRANCHED_JSONL, 'utf-8');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('scanClaudeRepairFile', () => {
  it('detects hidden assistant messages in a branched session', async () => {
    const stats = await scanClaudeRepairFile(sessionFile);
    expect(stats.hidden).toBe(1);
    expect(stats.shown).toBe(1);
  });
});

describe('scanClaudeRepairIssues', () => {
  it('lists sessions that need repair', async () => {
    const issues = await scanClaudeRepairIssues(configDir);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      id: 'repair-session-001',
      project: 'repairproj',
      hidden: 1,
    });
  });
});

describe('repairClaudeSessionFile', () => {
  it('linearizes the main chain and creates a backup', async () => {
    const result = await repairClaudeSessionFile(sessionFile, { configDir });
    expect(result.ok).toBe(true);
    expect(result.relinked).toBe(3);
    await expect(fs.access(`${sessionFile}.bak`)).resolves.toBeUndefined();

    const stats = await scanClaudeRepairFile(sessionFile);
    expect(stats.hidden).toBe(0);

    const lines = (await fs.readFile(sessionFile, 'utf-8')).split('\n').filter(Boolean);
    const assistantTwo = lines.map(line => JSON.parse(line)).find(row => row.uuid === 'a2');
    expect(assistantTwo.parentUuid).toBe('a1');
  });

  it('can repair without creating a backup when backup is disabled', async () => {
    const result = await repairClaudeSessionFile(sessionFile, {
      configDir,
      backup: false,
    });

    expect(result.ok).toBe(true);
    expect(result.backupPath).toBeUndefined();
    await expect(fs.access(`${sessionFile}.bak`)).rejects.toThrow();
  });
});

describe('deleteClaudeSessionMessages', () => {
  it('backs up, deletes selected messages, and repairs dangling tool_use blocks', async () => {
    const toolSession = [
      '{"type":"queue-operation","operation":"enqueue","timestamp":"2026-06-01T02:40:05.900Z","sessionId":"tool-session-001"}',
      '{"uuid":"u1","parentUuid":null,"isSidechain":false,"type":"user","message":{"role":"user","content":[{"type":"text","text":"Run tool"}]},"cwd":"/home/user/repairproj","timestamp":"2026-06-01T02:40:06.000Z","sessionId":"tool-session-001"}',
      '{"uuid":"a1","parentUuid":"u1","isSidechain":false,"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"I will call a tool"},{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"true"}}]},"timestamp":"2026-06-01T02:41:00.000Z","sessionId":"tool-session-001"}',
      '{"uuid":"u2","parentUuid":"a1","isSidechain":false,"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"ok"}]},"cwd":"/home/user/repairproj","timestamp":"2026-06-01T02:41:30.000Z","sessionId":"tool-session-001"}',
      '{"uuid":"a2","parentUuid":"u2","isSidechain":false,"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Done"}]},"timestamp":"2026-06-01T02:42:00.000Z","sessionId":"tool-session-001"}',
      '{"type":"last-prompt","leafUuid":"a2"}',
    ].join('\n') + '\n';
    await fs.writeFile(sessionFile, toolSession, 'utf-8');

    const result = await deleteClaudeSessionMessages(sessionFile, ['u2'], { configDir });

    expect(result.ok).toBe(true);
    expect(result.deletedIds).toEqual(['u2']);
    expect(result.backupPath).toBeDefined();
    await expect(fs.access(result.backupPath!)).resolves.toBeUndefined();
    expect(result.repair.inserted).toBe(1);

    const rows = (await fs.readFile(sessionFile, 'utf-8'))
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
    expect(rows.some(row => row.uuid === 'u2')).toBe(false);
    expect(rows.some(row => JSON.stringify(row).includes('cc-fix:synthetic placeholder'))).toBe(true);

    const finalPrompt = rows.find(row => row.type === 'last-prompt');
    expect(finalPrompt.leafUuid).toBe('a2');
  });

  it('can delete messages without creating a backup when backup is disabled', async () => {
    const result = await deleteClaudeSessionMessages(sessionFile, ['a1'], {
      configDir,
      backup: false,
    });

    expect(result.ok).toBe(true);
    expect(result.backupPath).toBeUndefined();
    await expect(fs.access(`${sessionFile}.bak`)).rejects.toThrow();
  });
});
