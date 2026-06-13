import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { ProviderUsage, UsageTier } from '@shared/types.js';

export function getClaudeConfigDir(): string {
  return path.join(os.homedir(), '.claude');
}

export function getCodexConfigDir(): string {
  return path.join(os.homedir(), '.codex');
}

const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';

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
    const utilization = typeof tierData.utilization === 'number' ? tierData.utilization : 0;
    const resetAt = typeof tierData.reset_at === 'number' ? tierData.reset_at : 0;

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

    const utilization = typeof entry.utilization === 'number' ? entry.utilization : 0;
    const resetAt = typeof entry.reset_at === 'number' ? entry.reset_at : 0;

    tiers.push({
      name: tierName,
      label: TIER_LABELS[tierName],
      utilization,
      resetAt,
    });
  }

  return tiers;
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

  try {
    const res = await fetch(CODEX_USAGE_URL, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      if (res.status === 401) {
        return { provider: 'codex', tiers: [], tokenExpired: true };
      }
      return { provider: 'codex', tiers: [], error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    return { provider: 'codex', tiers: parseCodexUsageResponse(data) };
  } catch (err) {
    return {
      provider: 'codex',
      tiers: [],
      error: err instanceof Error ? err.message : 'Unknown error',
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
