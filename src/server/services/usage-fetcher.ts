import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import type { Provider, ProviderUsage, UsageTier } from '@shared/types.js';

export function getClaudeConfigDir(): string {
  return path.join(os.homedir(), '.claude');
}

export function getCodexConfigDir(): string {
  return path.join(os.homedir(), '.codex');
}

const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CLAUDE_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const CLAUDE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const CLAUDE_DEFAULT_SCOPES = [
  'user:profile',
  'user:inference',
  'user:sessions:claude_code',
  'user:mcp_servers',
  'user:file_upload',
];
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const CODEX_APP_SERVER_TIMEOUT_MS = 12_000;
const CODEX_USAGE_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const CLAUDE_USAGE_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

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

interface ClaudeOauthCredentials {
  accessToken?: unknown;
  refreshToken?: unknown;
  expiresAt?: unknown;
  scopes?: unknown;
  [key: string]: unknown;
}

interface ClaudeCredentialsFile {
  claudeAiOauth?: ClaudeOauthCredentials;
  [key: string]: unknown;
}

export interface ClaudeTokenResolution {
  token: string | null;
  authInvalid: boolean;
  error?: string;
}

const claudeRefreshInflight = new Map<string, Promise<ClaudeTokenResolution>>();

async function readClaudeCredentials(
  claudeDir?: string,
): Promise<{ credPath: string; data: ClaudeCredentialsFile; oauth: ClaudeOauthCredentials } | null> {
  const baseDir = claudeDir ?? getClaudeConfigDir();
  const credPath = path.join(baseDir, '.credentials.json');
  try {
    const data = JSON.parse(await fs.readFile(credPath, 'utf-8')) as ClaudeCredentialsFile;
    if (!data?.claudeAiOauth || typeof data.claudeAiOauth !== 'object') return null;
    return { credPath, data, oauth: data.claudeAiOauth };
  } catch {
    return null;
  }
}

async function writeClaudeCredentialsAtomically(
  credPath: string,
  data: ClaudeCredentialsFile,
): Promise<void> {
  const tempPath = `${credPath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  try {
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), { mode: 0o600 });
    await fs.rename(tempPath, credPath);
    await fs.chmod(credPath, 0o600);
  } catch (err) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw err;
  }
}

function claudeRefreshError(
  status: number,
  body: Record<string, unknown> | null,
): ClaudeTokenResolution {
  const code = typeof body?.error === 'string' ? body.error : null;
  const description =
    typeof body?.error_description === 'string' ? body.error_description : null;
  const authInvalid = code === 'invalid_grant' || code === 'invalid_token';
  return {
    token: null,
    authInvalid,
    error: description || code || `Claude OAuth refresh failed (HTTP ${status})`,
  };
}

async function refreshClaudeToken(
  credentials: { credPath: string; data: ClaudeCredentialsFile; oauth: ClaudeOauthCredentials },
): Promise<ClaudeTokenResolution> {
  const refreshToken = credentials.oauth.refreshToken;
  if (typeof refreshToken !== 'string' || !refreshToken) {
    return {
      token: null,
      authInvalid: true,
      error: 'Claude access token expired and no refresh token is available',
    };
  }

  try {
    const body: Record<string, unknown> = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLAUDE_OAUTH_CLIENT_ID,
    };
    const scopes = Array.isArray(credentials.oauth.scopes)
      ? credentials.oauth.scopes.filter(
        (scope): scope is string => typeof scope === 'string',
      )
      : [];
    body.scope = (scopes.length > 0 ? scopes : CLAUDE_DEFAULT_SCOPES).join(' ');

    const res = await fetch(CLAUDE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    let response: Record<string, unknown> | null = null;
    try {
      response = (await res.json()) as Record<string, unknown>;
    } catch {
      // The HTTP status still gives us a useful transient error below.
    }

    if (!res.ok) return claudeRefreshError(res.status, response);

    const accessToken = response?.access_token;
    const expiresIn = response?.expires_in;
    if (
      typeof accessToken !== 'string' ||
      typeof expiresIn !== 'number' ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 0
    ) {
      return {
        token: null,
        authInvalid: false,
        error: 'Claude OAuth refresh returned an invalid response',
      };
    }

    // Claude itself may have refreshed the same rotating token while our request
    // was in flight. Prefer that newer credential rather than overwriting it.
    const current = await readClaudeCredentials(path.dirname(credentials.credPath));
    if (
      current &&
      typeof current.oauth.accessToken === 'string' &&
      (current.oauth.refreshToken !== refreshToken ||
        current.oauth.accessToken !== credentials.oauth.accessToken) &&
      (typeof current.oauth.expiresAt !== 'number' || current.oauth.expiresAt > Date.now())
    ) {
      return { token: current.oauth.accessToken, authInvalid: false };
    }

    const latestData = current?.data ?? credentials.data;
    const latestOauth = current?.oauth ?? credentials.oauth;
    const scope = response?.scope;
    const refreshedOauth: ClaudeOauthCredentials = {
      ...latestOauth,
      accessToken,
      refreshToken:
        typeof response?.refresh_token === 'string' ? response.refresh_token : refreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
    };
    if (typeof scope === 'string') refreshedOauth.scopes = scope.split(' ').filter(Boolean);

    await writeClaudeCredentialsAtomically(credentials.credPath, {
      ...latestData,
      claudeAiOauth: refreshedOauth,
    });
    return { token: accessToken, authInvalid: false };
  } catch (err) {
    return {
      token: null,
      authInvalid: false,
      error: err instanceof Error ? err.message : 'Claude OAuth refresh failed',
    };
  }
}

export async function resolveClaudeToken(
  claudeDir?: string,
  forceRefresh = false,
): Promise<ClaudeTokenResolution> {
  const credentials = await readClaudeCredentials(claudeDir);
  if (!credentials) {
    return { token: null, authInvalid: true, error: 'Claude credentials are unavailable' };
  }

  const { accessToken, expiresAt } = credentials.oauth;
  const isUsable =
    typeof accessToken === 'string' &&
    (typeof expiresAt !== 'number' || expiresAt > Date.now() + 60_000);
  if (!forceRefresh && isUsable) {
    return { token: accessToken, authInvalid: false };
  }

  const key = credentials.credPath;
  const running = claudeRefreshInflight.get(key);
  if (running) return running;

  const request = refreshClaudeToken(credentials).finally(() => {
    claudeRefreshInflight.delete(key);
  });
  claudeRefreshInflight.set(key, request);
  return request;
}

export async function readCodexToken(codexDir?: string): Promise<string | null> {
  const baseDir = codexDir ?? getCodexConfigDir();
  const authPath = path.join(baseDir, 'auth.json');

  try {
    const raw = await fs.readFile(authPath, 'utf-8');
    const data = JSON.parse(raw);

    if (data?.auth_mode !== 'chatgpt') return null;

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

function claudeUsageCachePath(): string {
  return path.join(getClaudeConfigDir(), 'cache', 'cc-manage-usage.json');
}

async function writeCachedClaudeUsage(usage: ProviderUsage): Promise<void> {
  try {
    const cachePath = claudeUsageCachePath();
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

async function readCachedClaudeUsage(
  error: string,
  tokenExpired = false,
): Promise<ProviderUsage | null> {
  try {
    const raw = await fs.readFile(claudeUsageCachePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.fetchedAt !== 'number' ||
      Date.now() - parsed.fetchedAt > CLAUDE_USAGE_CACHE_MAX_AGE_MS ||
      typeof parsed?.usage !== 'object' ||
      parsed.usage === null
    ) {
      return null;
    }

    return {
      ...(parsed.usage as ProviderUsage),
      source: 'claude-cache',
      tokenExpired: tokenExpired || undefined,
      extra: {
        ...((parsed.usage as ProviderUsage).extra ?? {}),
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
  const resolved = await resolveClaudeToken();
  if (!resolved.token) {
    const error = resolved.error || 'Claude OAuth token unavailable';
    const cached = await readCachedClaudeUsage(error, resolved.authInvalid);
    if (cached) return cached;
    return {
      provider: 'claude',
      tiers: [],
      tokenExpired: resolved.authInvalid || undefined,
      error: resolved.authInvalid ? undefined : error,
    };
  }

  try {
    const requestUsage = (token: string) =>
      fetch(CLAUDE_USAGE_URL, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
    let res = await requestUsage(resolved.token);

    // The access token can be revoked before its local expiry. Refresh once and
    // retry before concluding that the user needs to authenticate again.
    if (res.status === 401) {
      const refreshed = await resolveClaudeToken(undefined, true);
      if (refreshed.token) {
        res = await requestUsage(refreshed.token);
      } else {
        const error = refreshed.error || 'Claude OAuth token rejected';
        const cached = await readCachedClaudeUsage(error, refreshed.authInvalid);
        if (cached) return cached;
        return {
          provider: 'claude',
          tiers: [],
          tokenExpired: refreshed.authInvalid || undefined,
          error: refreshed.authInvalid ? undefined : error,
        };
      }
    }

    if (!res.ok) {
      if (res.status === 401) {
        const cached = await readCachedClaudeUsage('Claude OAuth token rejected after refresh');
        if (cached) return cached;
        return {
          provider: 'claude',
          tiers: [],
          error: 'Claude OAuth token was rejected after refresh',
        };
      }
      const error = `HTTP ${res.status}`;
      const cached = await readCachedClaudeUsage(error);
      if (cached) return cached;
      return { provider: 'claude', tiers: [], error };
    }

    const data = await res.json();
    const usage: ProviderUsage = {
      provider: 'claude',
      tiers: parseClaudeUsageResponse(data),
      source: 'anthropic-oauth',
    };
    if (usage.tiers.length > 0) await writeCachedClaudeUsage(usage);
    return usage;
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    const cached = await readCachedClaudeUsage(error);
    if (cached) return cached;
    return {
      provider: 'claude',
      tiers: [],
      error,
    };
  }
}

async function fetchCodexUsage(): Promise<ProviderUsage> {
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

  // The app-server owns token refresh. Only require a readable access token for
  // the HTTP fallback after the local source has actually failed.
  const token = await readCodexToken();
  if (!token) {
    const error = appServerError
      ? `Codex app-server: ${appServerError}; HTTP fallback token unavailable`
      : 'Codex access token unavailable';
    const cached = await readCachedCodexUsage(error);
    if (cached) return cached;
    return { provider: 'codex', tiers: [], tokenExpired: true, error };
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
        const error = appServerError
          ? `Codex app-server: ${appServerError}; HTTP fallback token rejected`
          : 'Codex HTTP fallback token rejected';
        const cached = await readCachedCodexUsage(error);
        if (cached) return cached;
        return { provider: 'codex', tiers: [], error };
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
  result: ProviderUsage;
  fetchedAt: number;
}

const cache = new Map<Provider, CacheEntry>();
const inflight = new Map<Provider, Promise<ProviderUsage>>();

export async function fetchProviderUsage(provider: Provider): Promise<ProviderUsage> {
  const now = Date.now();
  const cached = cache.get(provider);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.result;
  }

  const running = inflight.get(provider);
  if (running) return running;

  const request = (provider === 'claude' ? fetchClaudeUsage() : fetchCodexUsage())
    .then(result => {
      cache.set(provider, { result, fetchedAt: Date.now() });
      return result;
    })
    .finally(() => {
      inflight.delete(provider);
    });
  inflight.set(provider, request);
  return request;
}

export async function fetchAllUsage(): Promise<ProviderUsage[]> {
  return Promise.all([
    fetchProviderUsage('claude'),
    fetchProviderUsage('codex'),
  ]);
}
