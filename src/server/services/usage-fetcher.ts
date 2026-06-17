import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import type { ProviderUsage, UsageTier } from '@shared/types.js';

export function getClaudeConfigDir(): string {
  return path.join(os.homedir(), '.claude');
}

export function getCodexConfigDir(): string {
  return path.join(os.homedir(), '.codex');
}

const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const CODEX_APP_SERVER_TIMEOUT_MS = 12_000;
const CODEX_USAGE_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

// 8 days in milliseconds
const CODEX_MAX_TOKEN_AGE_MS = 8 * 24 * 60 * 60 * 1000;

// 10-second cache
const CACHE_TTL_MS = 10_000;

const TIER_LABELS: Record<string, string> = {
  five_hour: '5 Hour',
  seven_day: '7 Day',
  seven_day_opus: '7 Day (Opus)',
  seven_day_sonnet: '7 Day (Sonnet)',
};

const WINDOW_SECONDS_TO_TIER: Record<number, string> = {
  18000: 'five_hour',
  604800: 'seven_day',
};

const WINDOW_MINUTES_TO_TIER: Record<number, string> = {
  300: 'five_hour',
  10080: 'seven_day',
};

function normalizeUtilization(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return value > 1 ? value / 100 : value;
}

function normalizeEpochMs(value: unknown): number {
  if (typeof value === 'string') {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

function labelForWindowMinutes(minutes: number | null, fallback: string): string {
  if (minutes === 300) return TIER_LABELS.five_hour;
  if (minutes === 10080) return TIER_LABELS.seven_day;
  if (!minutes || !Number.isFinite(minutes)) return fallback;
  if (minutes % 1440 === 0) return `${minutes / 1440} Day`;
  if (minutes % 60 === 0) return `${minutes / 60} Hour`;
  return `${minutes} Minute`;
}

// --- Token reading ---

export async function readClaudeToken(claudeDir?: string): Promise<string | null> {
  const baseDir = claudeDir ?? getClaudeConfigDir();
  const credPath = path.join(baseDir, '.credentials.json');

  try {
    const raw = await fs.readFile(credPath, 'utf-8');
    const data = JSON.parse(raw);
    const oauth = data?.claudeAiOauth;
    if (!oauth || typeof oauth.accessToken !== 'string') return null;

    // Check expiry
    if (typeof oauth.expiresAt === 'number' && oauth.expiresAt <= Date.now()) {
      return null;
    }

    return oauth.accessToken;
  } catch {
    return null;
  }
}

export async function readCodexToken(codexDir?: string): Promise<string | null> {
  const baseDir = codexDir ?? getCodexConfigDir();
  const authPath = path.join(baseDir, 'auth.json');

  try {
    const raw = await fs.readFile(authPath, 'utf-8');
    const data = JSON.parse(raw);

    if (data?.auth_mode !== 'chatgpt') return null;

    // Check last_refresh age
    if (typeof data.last_refresh === 'string') {
      const refreshTime = new Date(data.last_refresh).getTime();
      if (isNaN(refreshTime) || Date.now() - refreshTime > CODEX_MAX_TOKEN_AGE_MS) {
        return null;
      }
    }

    const token = data?.tokens?.access_token;
    if (typeof token !== 'string') return null;

    return token;
  } catch {
    return null;
  }
}

// --- Response parsing ---

export function parseClaudeUsageResponse(data: Record<string, unknown>): UsageTier[] {
  const tiers: UsageTier[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (!(key in TIER_LABELS)) continue;
    if (typeof value !== 'object' || value === null) continue;

    const tierData = value as Record<string, unknown>;
    const utilization = normalizeUtilization(tierData.utilization);
    const resetAt = normalizeEpochMs(tierData.resets_at ?? tierData.reset_at);

    tiers.push({
      name: key,
      label: TIER_LABELS[key],
      utilization,
      resetAt,
    });
  }

  return tiers;
}

export function parseCodexUsageResponse(data: Record<string, unknown>): UsageTier[] {
  const tiers: UsageTier[] = [];

  const usage = data?.usage;
  if (!Array.isArray(usage)) return tiers;

  for (const item of usage) {
    if (typeof item !== 'object' || item === null) continue;
    const entry = item as Record<string, unknown>;

    const windowSeconds = entry.window_seconds;
    if (typeof windowSeconds !== 'number') continue;

    const tierName = WINDOW_SECONDS_TO_TIER[windowSeconds];
    if (!tierName) continue;

    const utilization = normalizeUtilization(entry.utilization);
    const resetAt = normalizeEpochMs(entry.reset_at ?? entry.resets_at);

    tiers.push({
      name: tierName,
      label: TIER_LABELS[tierName],
      utilization,
      resetAt,
    });
  }

  return tiers;
}

interface CodexAppServerResponse {
  id?: string | number;
  result?: unknown;
  error?: { message?: string };
}

async function callCodexAppServer(method: string): Promise<unknown> {
  const binary = process.env.CODEX_CLI || 'codex';

  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['app-server', '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (err: Error | null, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (err) reject(err);
      else resolve(value);
    };

    const timer = setTimeout(() => {
      finish(new Error('Codex app-server timed out'));
    }, CODEX_APP_SERVER_TIMEOUT_MS);

    child.on('error', err => {
      finish(err);
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();

      let newlineIndex: number;
      while ((newlineIndex = stdout.indexOf('\n')) >= 0) {
        const line = stdout.slice(0, newlineIndex).trim();
        stdout = stdout.slice(newlineIndex + 1);
        if (!line) continue;

        let response: CodexAppServerResponse;
        try {
          response = JSON.parse(line);
        } catch {
          continue;
        }

        if (response.id !== 2) continue;

        if (response.error) {
          finish(new Error(response.error.message || 'Codex app-server request failed'));
          return;
        }

        finish(null, response.result);
        return;
      }
    });

    child.on('exit', code => {
      if (!settled) {
        finish(
          new Error(
            `Codex app-server exited before responding${code === null ? '' : ` (code ${code})`}${
              stderr ? `: ${stderr.trim()}` : ''
            }`,
          ),
        );
      }
    });

    const write = (payload: unknown) => {
      child.stdin.write(`${JSON.stringify(payload)}\n`);
    };

    write({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'cc-manage', version: '0.1.0' },
        capabilities: null,
      },
    });
    write({ method: 'initialized' });
    write({ id: 2, method });
  });
}

async function callCodexAppServerWithRetries(
  method: string,
  attempts = 3,
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await callCodexAppServer(method);
    } catch (err) {
      lastError = err;
      if (attempt < attempts - 1) {
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Codex app-server failed');
}

function codexUsageCachePath(): string {
  return path.join(getCodexConfigDir(), 'cache', 'cc-manage-usage.json');
}

async function writeCachedCodexUsage(usage: ProviderUsage): Promise<void> {
  try {
    const cachePath = codexUsageCachePath();
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(
      cachePath,
      JSON.stringify({ fetchedAt: Date.now(), usage }, null, 2),
      'utf-8',
    );
  } catch {
    // Cache is best-effort only.
  }
}

async function readCachedCodexUsage(error: string): Promise<ProviderUsage | null> {
  try {
    const raw = await fs.readFile(codexUsageCachePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.fetchedAt !== 'number' ||
      Date.now() - parsed.fetchedAt > CODEX_USAGE_CACHE_MAX_AGE_MS ||
      typeof parsed?.usage !== 'object' ||
      parsed.usage === null
    ) {
      return null;
    }

    const usage = parsed.usage as ProviderUsage;
    return {
      ...usage,
      source: 'codex-cache',
      extra: {
        ...(usage.extra ?? {}),
        cachedAt: parsed.fetchedAt,
        refreshError: error,
      },
    };
  } catch {
    return null;
  }
}

function parseRateLimitWindow(
  snapshot: Record<string, unknown>,
  key: 'primary' | 'secondary',
  fallbackName: string,
): UsageTier | null {
  const window = snapshot[key];
  if (typeof window !== 'object' || window === null) return null;
  const data = window as Record<string, unknown>;
  const windowMinutes =
    typeof data.windowDurationMins === 'number' ? data.windowDurationMins : null;
  const tierName =
    windowMinutes && WINDOW_MINUTES_TO_TIER[windowMinutes]
      ? WINDOW_MINUTES_TO_TIER[windowMinutes]
      : `${fallbackName}_${key}`;

  return {
    name: tierName,
    label: labelForWindowMinutes(windowMinutes, key === 'primary' ? 'Primary' : 'Secondary'),
    utilization:
      typeof data.usedPercent === 'number' && Number.isFinite(data.usedPercent)
        ? data.usedPercent / 100
        : normalizeUtilization(data.utilization),
    resetAt: normalizeEpochMs(data.resetsAt),
    windowMinutes: windowMinutes ?? undefined,
  };
}

export function parseCodexRateLimitsResponse(data: Record<string, unknown>): ProviderUsage {
  const byLimitId = data.rateLimitsByLimitId;
  let snapshot: Record<string, unknown> | null = null;

  if (typeof byLimitId === 'object' && byLimitId !== null) {
    const codex = (byLimitId as Record<string, unknown>).codex;
    if (typeof codex === 'object' && codex !== null) {
      snapshot = codex as Record<string, unknown>;
    }
  }

  if (!snapshot && typeof data.rateLimits === 'object' && data.rateLimits !== null) {
    snapshot = data.rateLimits as Record<string, unknown>;
  }

  if (!snapshot) {
    return {
      provider: 'codex',
      tiers: [],
      source: 'codex-app-server',
      error: 'Codex app-server returned no rate limit snapshot',
    };
  }

  const limitId = typeof snapshot.limitId === 'string' ? snapshot.limitId : 'codex';
  const tiers = [
    parseRateLimitWindow(snapshot, 'primary', limitId),
    parseRateLimitWindow(snapshot, 'secondary', limitId),
  ].filter((tier): tier is UsageTier => tier !== null);

  const individualLimit = snapshot.individualLimit;
  if (typeof individualLimit === 'object' && individualLimit !== null) {
    const limit = individualLimit as Record<string, unknown>;
    tiers.push({
      name: `${limitId}_individual`,
      label: 'Individual Limit',
      utilization:
        typeof limit.remainingPercent === 'number'
          ? 1 - Math.max(0, Math.min(limit.remainingPercent, 100)) / 100
          : 0,
      resetAt: normalizeEpochMs(limit.resetsAt),
      detail:
        typeof limit.used === 'string' && typeof limit.limit === 'string'
          ? `${limit.used} / ${limit.limit}`
          : undefined,
    });
  }

  const credits = snapshot.credits as Record<string, unknown> | null | undefined;

  return {
    provider: 'codex',
    tiers,
    source: 'codex-app-server',
    extra: {
      limitId,
      limitName: typeof snapshot.limitName === 'string' ? snapshot.limitName : null,
      planType: typeof snapshot.planType === 'string' ? snapshot.planType : null,
      rateLimitReachedType:
        typeof snapshot.rateLimitReachedType === 'string' ? snapshot.rateLimitReachedType : null,
      hasCredits: typeof credits?.hasCredits === 'boolean' ? credits.hasCredits : null,
      creditsUnlimited: typeof credits?.unlimited === 'boolean' ? credits.unlimited : null,
      creditBalance: typeof credits?.balance === 'string' ? credits.balance : null,
    },
  };
}

// --- Fetch functions ---

async function fetchClaudeUsage(): Promise<ProviderUsage> {
  const token = await readClaudeToken();
  if (!token) {
    return { provider: 'claude', tiers: [], tokenExpired: true };
  }

  try {
    const res = await fetch(CLAUDE_USAGE_URL, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      if (res.status === 401) {
        return { provider: 'claude', tiers: [], tokenExpired: true };
      }
      return { provider: 'claude', tiers: [], error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    return { provider: 'claude', tiers: parseClaudeUsageResponse(data) };
  } catch (err) {
    return {
      provider: 'claude',
      tiers: [],
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

async function fetchCodexUsage(): Promise<ProviderUsage> {
  const token = await readCodexToken();
  if (!token) {
    return { provider: 'codex', tiers: [], tokenExpired: true };
  }

  let appServerError: string | null = null;
  try {
    const rateLimits = await callCodexAppServerWithRetries('account/rateLimits/read');
    if (typeof rateLimits === 'object' && rateLimits !== null) {
      const parsed = parseCodexRateLimitsResponse(rateLimits as Record<string, unknown>);
      if (parsed.tiers.length > 0) {
        await writeCachedCodexUsage(parsed);
        return parsed;
      }
      appServerError = parsed.error ?? 'Codex app-server returned no tiers';
    }
  } catch (err) {
    appServerError = err instanceof Error ? err.message : 'Codex app-server failed';
  }

  try {
    const res = await fetch(CODEX_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'cc-manage',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      if (res.status === 401) {
        return { provider: 'codex', tiers: [], tokenExpired: true };
      }
      const error = appServerError
        ? `Codex app-server: ${appServerError}; HTTP fallback: ${res.status}`
        : `HTTP ${res.status}`;
      const cached = await readCachedCodexUsage(error);
      if (cached) return cached;
      return { provider: 'codex', tiers: [], error };
    }

    const data = await res.json();
    const tiers = parseCodexUsageResponse(data);
    const usage: ProviderUsage = {
      provider: 'codex',
      tiers,
      source: 'chatgpt-wham',
      error: tiers.length === 0 && appServerError ? `Codex app-server: ${appServerError}` : undefined,
    };
    if (tiers.length > 0) await writeCachedCodexUsage(usage);
    return usage;
  } catch (err) {
    const error = appServerError
      ? `Codex app-server: ${appServerError}; HTTP fallback: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`
      : err instanceof Error
        ? err.message
        : 'Unknown error';
    const cached = await readCachedCodexUsage(error);
    if (cached) return cached;

    return {
      provider: 'codex',
      tiers: [],
      error,
    };
  }
}

// --- Cache ---

interface CacheEntry {
  result: ProviderUsage[];
  fetchedAt: number;
}

let cache: CacheEntry | null = null;
let inflight: Promise<ProviderUsage[]> | null = null;

export async function fetchAllUsage(): Promise<ProviderUsage[]> {
  const now = Date.now();

  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.result;
  }

  if (inflight) {
    return inflight;
  }

  inflight = (async () => {
    try {
      const [claudeUsage, codexUsage] = await Promise.all([
        fetchClaudeUsage(),
        fetchCodexUsage(),
      ]);
      const result = [claudeUsage, codexUsage];
      cache = { result, fetchedAt: Date.now() };
      return result;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
