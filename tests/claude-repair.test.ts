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

const COMPACTED_JSONL = [
  '{"uuid":"u1","parentUuid":null,"isSidechain":false,"type":"user","message":{"role":"user","content":[{"type":"text","text":"Start"}]},"cwd":"/home/user/repairproj","timestamp":"2026-06-01T02:40:06.000Z","sessionId":"repair-session-001"}',
  '{"uuid":"a1","parentUuid":"u1","isSidechain":false,"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Before compact"}]},"timestamp":"2026-06-01T02:41:00.000Z","sessionId":"repair-session-001"}',
  '{"uuid":"c1","parentUuid":null,"logicalParentUuid":"a1","isSidechain":false,"type":"system","subtype":"compact_boundary","compactMetadata":{"trigger":"manual"},"timestamp":"2026-06-01T02:42:00.000Z","sessionId":"repair-session-001"}',
  '{"uuid":"u2","parentUuid":"c1","isSidechain":false,"type":"user","isCompactSummary":true,"isVisibleInTranscriptOnly":true,"message":{"role":"user","content":[{"type":"text","text":"Summary"}]},"timestamp":"2026-06-01T02:42:01.000Z","sessionId":"repair-session-001"}',
  '{"uuid":"a2","parentUuid":"u2","isSidechain":false,"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"After compact"}]},"timestamp":"2026-06-01T02:43:00.000Z","sessionId":"repair-session-001"}',
  '{"type":"last-prompt","leafUuid":"a2"}',
].join('\n') + '\n';

const BROKEN_COMPACT_JSONL = COMPACTED_JSONL.replace(
  '"logicalParentUuid":"a1"',
  '"logicalParentUuid":"missing"',
);

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

  it('treats a detached compact boundary with a valid logical parent as healthy', async () => {
    await fs.writeFile(sessionFile, COMPACTED_JSONL, 'utf-8');

    const stats = await scanClaudeRepairFile(sessionFile);

    expect(stats).toMatchObject({
      roots: 1,
      shown: 2,
      hidden: 0,
      compactions: 1,
      invalidCompactions: 0,
    });
  });

  it('still detects a compact boundary when both parent links are broken', async () => {
    await fs.writeFile(sessionFile, BROKEN_COMPACT_JSONL, 'utf-8');

    const stats = await scanClaudeRepairFile(sessionFile);

    expect(stats).toMatchObject({
      roots: 2,
      shown: 1,
      hidden: 1,
      compactions: 1,
      invalidCompactions: 1,
    });
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

  it('does not list a healthy compacted session', async () => {
    await fs.writeFile(sessionFile, COMPACTED_JSONL, 'utf-8');

    await expect(scanClaudeRepairIssues(configDir)).resolves.toEqual([]);
  });

  it('lists a genuinely broken compacted session but blocks automatic repair', async () => {
    await fs.writeFile(sessionFile, BROKEN_COMPACT_JSONL, 'utf-8');

    const issues = await scanClaudeRepairIssues(configDir);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      hidden: 1,
      compactions: 1,
      invalidCompactions: 1,
      repairable: false,
    });
    expect(issues[0].repairBlockedReason).toContain('compact');
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

  it('leaves a healthy compacted session byte-for-byte unchanged', async () => {
    await fs.writeFile(sessionFile, COMPACTED_JSONL, 'utf-8');

    const result = await repairClaudeSessionFile(sessionFile, { configDir });

    expect(result).toMatchObject({ ok: true, changed: false, relinked: 0 });
    await expect(fs.readFile(sessionFile, 'utf-8')).resolves.toBe(COMPACTED_JSONL);
    await expect(fs.access(`${sessionFile}.bak`)).rejects.toThrow();
  });

  it('refuses to flatten a genuinely broken compacted session', async () => {
    await fs.writeFile(sessionFile, BROKEN_COMPACT_JSONL, 'utf-8');

    const result = await repairClaudeSessionFile(sessionFile, { configDir });

    expect(result).toMatchObject({ ok: false, changed: false, relinked: 0 });
    expect(result.error).toContain('compact');
    await expect(fs.readFile(sessionFile, 'utf-8')).resolves.toBe(BROKEN_COMPACT_JSONL);
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

  it('updates last-prompt when deleting the current leaf from a healthy session', async () => {
    const linearSession = [
      '{"uuid":"u1","parentUuid":null,"isSidechain":false,"type":"user","message":{"role":"user","content":[{"type":"text","text":"Start"}]},"timestamp":"2026-06-01T02:40:06.000Z","sessionId":"repair-session-001"}',
      '{"uuid":"a1","parentUuid":"u1","isSidechain":false,"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"First"}]},"timestamp":"2026-06-01T02:41:00.000Z","sessionId":"repair-session-001"}',
      '{"uuid":"u2","parentUuid":"a1","isSidechain":false,"type":"user","message":{"role":"user","content":[{"type":"text","text":"Continue"}]},"timestamp":"2026-06-01T02:42:00.000Z","sessionId":"repair-session-001"}',
      '{"uuid":"a2","parentUuid":"u2","isSidechain":false,"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Last"}]},"timestamp":"2026-06-01T02:43:00.000Z","sessionId":"repair-session-001"}',
      '{"type":"last-prompt","leafUuid":"a2"}',
    ].join('\n') + '\n';
    await fs.writeFile(sessionFile, linearSession, 'utf-8');

    await deleteClaudeSessionMessages(sessionFile, ['a2'], { configDir });

    const rows = (await fs.readFile(sessionFile, 'utf-8'))
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
    expect(rows.find(row => row.type === 'last-prompt').leafUuid).toBe('u2');
  });

  it('refuses message deletion when it would flatten compact history', async () => {
    await fs.writeFile(sessionFile, COMPACTED_JSONL, 'utf-8');

    await expect(
      deleteClaudeSessionMessages(sessionFile, ['a2'], { configDir }),
    ).rejects.toThrow(/compact/i);
    await expect(fs.readFile(sessionFile, 'utf-8')).resolves.toBe(COMPACTED_JSONL);
    await expect(fs.access(`${sessionFile}.bak`)).rejects.toThrow();
  });
});
