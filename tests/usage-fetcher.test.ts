import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  readClaudeToken,
  resolveClaudeToken,
  readCodexToken,
  parseClaudeUsageResponse,
  parseCodexUsageResponse,
  parseCodexRateLimitsResponse,
} from '../src/server/services/usage-fetcher.js';

let tmpDir: string;
let claudeDir: string;
let codexDir: string;

const FUTURE_EXPIRES_AT = Date.now() + 1000 * 60 * 60 * 24 * 30; // 30 days from now
const PAST_EXPIRES_AT = Date.now() - 1000; // Already expired

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-fetcher-test-'));
  claudeDir = path.join(tmpDir, 'claude');
  codexDir = path.join(tmpDir, 'codex');
  await fs.mkdir(claudeDir, { recursive: true });
  await fs.mkdir(codexDir, { recursive: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('readClaudeToken', () => {
  it('returns access token when valid', async () => {
    const creds = {
      claudeAiOauth: {
        accessToken: 'sk-ant-test-token',
        expiresAt: FUTURE_EXPIRES_AT,
      },
    };
    await fs.writeFile(
      path.join(claudeDir, '.credentials.json'),
      JSON.stringify(creds),
      'utf-8',
    );

    const token = await readClaudeToken(claudeDir);
    expect(token).toBe('sk-ant-test-token');
  });

  it('returns null when token is expired', async () => {
    const creds = {
      claudeAiOauth: {
        accessToken: 'sk-ant-expired-token',
        expiresAt: PAST_EXPIRES_AT,
      },
    };
    await fs.writeFile(
      path.join(claudeDir, '.credentials.json'),
      JSON.stringify(creds),
      'utf-8',
    );

    const token = await readClaudeToken(claudeDir);
    expect(token).toBeNull();
  });

  it('returns null when credentials file does not exist', async () => {
    const token = await readClaudeToken(claudeDir);
    expect(token).toBeNull();
  });

  it('returns null when credentials file has invalid JSON', async () => {
    await fs.writeFile(
      path.join(claudeDir, '.credentials.json'),
      'not valid json{',
      'utf-8',
    );
    const token = await readClaudeToken(claudeDir);
    expect(token).toBeNull();
  });
});

describe('readCodexToken', () => {
  it('returns access token when auth_mode is chatgpt and last_refresh is recent', async () => {
    const recentRefresh = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1 hour ago
    const auth = {
      auth_mode: 'chatgpt',
      last_refresh: recentRefresh,
      tokens: { access_token: 'eyJ-test-token' },
    };
    await fs.writeFile(
      path.join(codexDir, 'auth.json'),
      JSON.stringify(auth),
      'utf-8',
    );

    const token = await readCodexToken(codexDir);
    expect(token).toBe('eyJ-test-token');
  });

  it('returns null when auth_mode is not chatgpt', async () => {
    const auth = {
      auth_mode: 'api_key',
      last_refresh: new Date().toISOString(),
      tokens: { access_token: 'some-token' },
    };
    await fs.writeFile(
      path.join(codexDir, 'auth.json'),
      JSON.stringify(auth),
      'utf-8',
    );

    const token = await readCodexToken(codexDir);
    expect(token).toBeNull();
  });

  it('does not expire a token based only on last_refresh age', async () => {
    const oldRefresh = new Date(Date.now() - 1000 * 60 * 60 * 24 * 9).toISOString(); // 9 days ago
    const auth = {
      auth_mode: 'chatgpt',
      last_refresh: oldRefresh,
      tokens: { access_token: 'eyJ-old-token' },
    };
    await fs.writeFile(
      path.join(codexDir, 'auth.json'),
      JSON.stringify(auth),
      'utf-8',
    );

    const token = await readCodexToken(codexDir);
    expect(token).toBe('eyJ-old-token');
  });

  it('returns null when auth file does not exist', async () => {
    const token = await readCodexToken(codexDir);
    expect(token).toBeNull();
  });

  it('returns null when auth file has invalid JSON', async () => {
    await fs.writeFile(path.join(codexDir, 'auth.json'), 'bad json', 'utf-8');
    const token = await readCodexToken(codexDir);
    expect(token).toBeNull();
  });
});

describe('resolveClaudeToken', () => {
  it('refreshes an expired access token and atomically persists rotated credentials', async () => {
    await fs.writeFile(
      path.join(claudeDir, '.credentials.json'),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'expired-access',
          refreshToken: 'old-refresh',
          expiresAt: PAST_EXPIRES_AT,
          scopes: ['user:profile', 'user:inference'],
          subscriptionType: 'pro',
        },
      }),
      { mode: 0o600 },
    );
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600,
          scope: 'user:profile user:inference',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await resolveClaudeToken(claudeDir);

    expect(result).toEqual({ token: 'new-access', authInvalid: false });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://platform.claude.com/v1/oauth/token',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'old-refresh',
      client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
      scope: 'user:profile user:inference',
    });

    const persisted = JSON.parse(
      await fs.readFile(path.join(claudeDir, '.credentials.json'), 'utf-8'),
    );
    expect(persisted.claudeAiOauth.accessToken).toBe('new-access');
    expect(persisted.claudeAiOauth.refreshToken).toBe('new-refresh');
    expect(persisted.claudeAiOauth.subscriptionType).toBe('pro');
    expect(persisted.claudeAiOauth.expiresAt).toBeGreaterThan(Date.now());
    expect((await fs.stat(path.join(claudeDir, '.credentials.json'))).mode & 0o777).toBe(0o600);
  });

  it('only marks an explicitly rejected refresh token as invalid auth', async () => {
    await fs.writeFile(
      path.join(claudeDir, '.credentials.json'),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'expired-access',
          refreshToken: 'invalid-refresh',
          expiresAt: PAST_EXPIRES_AT,
        },
      }),
      'utf-8',
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'invalid_grant', error_description: 'Refresh token expired' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(resolveClaudeToken(claudeDir)).resolves.toEqual({
      token: null,
      authInvalid: true,
      error: 'Refresh token expired',
    });
  });

  it('treats refresh network failures as transient instead of requiring login', async () => {
    await fs.writeFile(
      path.join(claudeDir, '.credentials.json'),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'expired-access',
          refreshToken: 'valid-refresh',
          expiresAt: PAST_EXPIRES_AT,
        },
      }),
      'utf-8',
    );
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network unavailable'));

    await expect(resolveClaudeToken(claudeDir)).resolves.toEqual({
      token: null,
      authInvalid: false,
      error: 'network unavailable',
    });
  });
});

describe('parseClaudeUsageResponse', () => {
  it('parses usage tiers from Claude API response with percentage utilization', () => {
    const data = {
      five_hour: { utilization: 42, resets_at: '2026-06-13T08:29:59.829Z' },
      seven_day: { utilization: 15, resets_at: '2026-06-15T04:59:59.829Z' },
    };

    const tiers = parseClaudeUsageResponse(data);
    expect(tiers.length).toBe(2);

    const fiveHour = tiers.find(t => t.name === 'five_hour');
    expect(fiveHour).toBeDefined();
    expect(fiveHour!.label).toBe('5 Hour');
    expect(fiveHour!.utilization).toBeCloseTo(0.42);
    expect(fiveHour!.resetAt).toBe(new Date('2026-06-13T08:29:59.829Z').getTime());

    const sevenDay = tiers.find(t => t.name === 'seven_day');
    expect(sevenDay).toBeDefined();
    expect(sevenDay!.label).toBe('7 Day');
    expect(sevenDay!.utilization).toBeCloseTo(0.15);
  });

  it('handles utilization already as ratio (0-1)', () => {
    const data = {
      five_hour: { utilization: 0.42, reset_at: 1700010000 },
    };
    const tiers = parseClaudeUsageResponse(data);
    expect(tiers[0].utilization).toBeCloseTo(0.42);
    expect(tiers[0].resetAt).toBe(1700010000 * 1000);
  });

  it('handles empty response data', () => {
    const tiers = parseClaudeUsageResponse({});
    expect(tiers).toEqual([]);
  });

  it('handles all known tier names', () => {
    const data = {
      five_hour: { utilization: 10, resets_at: '2026-06-13T08:00:00Z' },
      seven_day: { utilization: 20, resets_at: '2026-06-15T08:00:00Z' },
      seven_day_opus: { utilization: 30, resets_at: '2026-06-15T08:00:00Z' },
      seven_day_sonnet: { utilization: 40, resets_at: '2026-06-15T08:00:00Z' },
    };
    const tiers = parseClaudeUsageResponse(data);
    expect(tiers.length).toBe(4);

    const opus = tiers.find(t => t.name === 'seven_day_opus');
    expect(opus!.label).toBe('7 Day (Opus)');

    const sonnet = tiers.find(t => t.name === 'seven_day_sonnet');
    expect(sonnet!.label).toBe('7 Day (Sonnet)');
  });

  it('skips unknown tier keys', () => {
    const data = {
      five_hour: { utilization: 50, resets_at: '2026-06-13T08:00:00Z' },
      unknown_tier: { utilization: 90, resets_at: '2026-06-13T08:00:00Z' },
    };
    const tiers = parseClaudeUsageResponse(data);
    expect(tiers.length).toBe(1);
    expect(tiers[0].name).toBe('five_hour');
  });
});

describe('parseCodexUsageResponse', () => {
  it('maps window_seconds to tier names', () => {
    const data = {
      usage: [
        { window_seconds: 18000, utilization: 0.6, reset_at: 1700010000 },
        { window_seconds: 604800, utilization: 0.25, reset_at: 1700700000 },
      ],
    };

    const tiers = parseCodexUsageResponse(data);
    expect(tiers.length).toBe(2);

    const fiveHour = tiers.find(t => t.name === 'five_hour');
    expect(fiveHour).toBeDefined();
    expect(fiveHour!.label).toBe('5 Hour');
    expect(fiveHour!.utilization).toBe(0.6);
    expect(fiveHour!.resetAt).toBe(1700010000 * 1000);

    const sevenDay = tiers.find(t => t.name === 'seven_day');
    expect(sevenDay).toBeDefined();
    expect(sevenDay!.label).toBe('7 Day');
    expect(sevenDay!.utilization).toBe(0.25);
  });

  it('handles empty usage array', () => {
    const tiers = parseCodexUsageResponse({ usage: [] });
    expect(tiers).toEqual([]);
  });

  it('handles missing usage field', () => {
    const tiers = parseCodexUsageResponse({});
    expect(tiers).toEqual([]);
  });

  it('skips unknown window_seconds values', () => {
    const data = {
      usage: [
        { window_seconds: 18000, utilization: 0.5, reset_at: 100 },
        { window_seconds: 99999, utilization: 0.9, reset_at: 200 },
      ],
    };
    const tiers = parseCodexUsageResponse(data);
    expect(tiers.length).toBe(1);
    expect(tiers[0].name).toBe('five_hour');
  });
});

describe('parseCodexRateLimitsResponse', () => {
  it('parses Codex app-server primary and secondary windows', () => {
    const usage = parseCodexRateLimitsResponse({
      rateLimits: {
        limitId: 'codex',
        limitName: null,
        planType: 'plus',
        primary: { usedPercent: 6, windowDurationMins: 300, resetsAt: 1781640414 },
        secondary: { usedPercent: 1, windowDurationMins: 10080, resetsAt: 1782227214 },
        credits: { hasCredits: false, unlimited: false, balance: '0' },
        individualLimit: null,
        rateLimitReachedType: null,
      },
      rateLimitsByLimitId: null,
    });

    expect(usage.provider).toBe('codex');
    expect(usage.source).toBe('codex-app-server');
    expect(usage.extra?.planType).toBe('plus');
    expect(usage.tiers).toHaveLength(2);
    expect(usage.tiers[0]).toMatchObject({
      name: 'five_hour',
      label: '5 Hour',
      utilization: 0.06,
      resetAt: 1781640414 * 1000,
      windowMinutes: 300,
    });
    expect(usage.tiers[1]).toMatchObject({
      name: 'seven_day',
      label: '7 Day',
      utilization: 0.01,
      resetAt: 1782227214 * 1000,
      windowMinutes: 10080,
    });
  });

  it('prefers the codex multi-bucket snapshot when present', () => {
    const usage = parseCodexRateLimitsResponse({
      rateLimits: {
        limitId: 'other',
        primary: { usedPercent: 90, windowDurationMins: 300, resetsAt: 100 },
      },
      rateLimitsByLimitId: {
        codex: {
          limitId: 'codex',
          primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 200 },
        },
      },
    });

    expect(usage.tiers[0].utilization).toBe(0.1);
    expect(usage.tiers[0].resetAt).toBe(200 * 1000);
  });
});
