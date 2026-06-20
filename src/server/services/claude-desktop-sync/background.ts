import { collectDesktopSessions } from './desktop-sessions.js';
import { isClaudeDesktopRunning } from './process-state.js';
import { runAutoSyncOnce } from './auto-sync.js';

type Logger = {
  debug?: (value: unknown, message?: string) => void;
  info?: (value: unknown, message?: string) => void;
  warn?: (value: unknown, message?: string) => void;
};

type SyncOptions = {
  claudeHome?: string;
  statePath?: string;
  desktopRoot?: string;
  desktopRoots?: string[];
  syncStatePath?: string;
  intervalMs?: number;
  syncWhileRunning?: boolean;
  enabled?: boolean;
  logger?: Logger;
};

type EnvironmentRoot = {
  root: string;
  present: boolean;
  configPresent: boolean;
  appConfigPresent: boolean;
  sessionCount: number;
};

export type ClaudeDesktopEnvironmentStatus = {
  available: boolean;
  reason: string | null;
  roots: EnvironmentRoot[];
};

export type ClaudeDesktopAutoSyncStatus = {
  enabled: boolean;
  started: boolean;
  stopped: boolean;
  running: boolean;
  pending: boolean;
  claudeRunning: boolean | null;
  pass: number;
  environment: ClaudeDesktopEnvironmentStatus | null;
  lastRequestedAt: string | null;
  lastRequestReason: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  lastSummary: {
    written: number;
    archived: number;
    reconciled: number;
    skipped: number;
  } | null;
};

export type ClaudeDesktopAutoSyncController = {
  ready: Promise<ClaudeDesktopAutoSyncStatus>;
  getStatus: () => ClaudeDesktopAutoSyncStatus;
  stop: () => Promise<void>;
  requestSync: (reason?: string) => Promise<ClaudeDesktopAutoSyncStatus>;
};

function envEnabled(value: string | undefined): boolean {
  if (value === undefined) return true;
  return !['0', 'false', 'off', 'no'].includes(value.trim().toLowerCase());
}

function intervalFromEnv(): number | undefined {
  const raw = process.env.CC_MANAGE_CLAUDE_DESKTOP_SYNC_INTERVAL;
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed * 1000 : undefined;
}

function summarizeEnvironmentRoot(root: any): EnvironmentRoot {
  return {
    root: root.root,
    present: Boolean(root.present),
    configPresent: Boolean(root.configPresent),
    appConfigPresent: Boolean(root.appConfigPresent),
    sessionCount: Number(root.sessionCount) || 0,
  };
}

export async function detectClaudeDesktopEnvironment(
  options: Pick<SyncOptions, 'desktopRoot' | 'desktopRoots'> = {},
): Promise<ClaudeDesktopEnvironmentStatus> {
  const desktop = await collectDesktopSessions(options);
  const roots = desktop.roots.map(summarizeEnvironmentRoot);
  const available = roots.some(root =>
    root.present && (root.configPresent || root.appConfigPresent || root.sessionCount > 0)
  );

  return {
    available,
    reason: available ? null : 'Claude Desktop data directory was not found.',
    roots,
  };
}

function cloneStatus(status: ClaudeDesktopAutoSyncStatus): ClaudeDesktopAutoSyncStatus {
  return {
    ...status,
    environment: status.environment
      ? { ...status.environment, roots: status.environment.roots.map(root => ({ ...root })) }
      : null,
    lastSummary: status.lastSummary ? { ...status.lastSummary } : null,
  };
}

export function startClaudeDesktopAutoSync(
  options: SyncOptions = {},
): ClaudeDesktopAutoSyncController {
  const logger = options.logger;
  const intervalMs = Math.max(1000, options.intervalMs ?? intervalFromEnv() ?? 5000);
  const enabled = options.enabled ?? envEnabled(process.env.CC_MANAGE_CLAUDE_DESKTOP_SYNC);
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let active: Promise<void> | null = null;
  let wasClaudeRunning = false;
  let syncedSinceClosed = false;
  let pendingSync = false;

  const status: ClaudeDesktopAutoSyncStatus = {
    enabled,
    started: false,
    stopped: false,
    running: false,
    pending: false,
    claudeRunning: null,
    pass: 0,
    environment: null,
    lastRequestedAt: null,
    lastRequestReason: null,
    lastRunAt: null,
    lastError: null,
    lastSummary: null,
  };

  const clearScheduled = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  const schedule = (delayMs: number) => {
    if (stopped || !status.started || timer) return;
    timer = setTimeout(() => {
      timer = null;
      active = tick().finally(() => {
        active = null;
      });
    }, delayMs);
    timer.unref?.();
  };

  const recordError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    status.lastError = message;
    logger?.warn?.({ err: error }, 'Claude Desktop auto-sync failed');
  };

  const ensureStarted = async (): Promise<boolean> => {
    if (!enabled || stopped) {
      return false;
    }
    if (status.started) {
      return true;
    }

    status.environment = await detectClaudeDesktopEnvironment(options);
    if (!status.environment.available) {
      pendingSync = false;
      status.pending = false;
      logger?.info?.(status.environment, 'Claude Desktop auto-sync not started');
      return false;
    }

    wasClaudeRunning = await isClaudeDesktopRunning();
    status.claudeRunning = wasClaudeRunning;
    status.started = true;
    logger?.info?.(
      { intervalMs, claudeRunning: wasClaudeRunning, roots: status.environment.roots },
      'Claude Desktop auto-sync started',
    );
    return true;
  };

  const tick = async () => {
    if (stopped || !status.started) return;
    status.pass += 1;
    status.running = true;

    try {
      const claudeRunning = await isClaudeDesktopRunning();
      status.claudeRunning = claudeRunning;
      const shouldSync = options.syncWhileRunning
        || (!claudeRunning && (pendingSync || wasClaudeRunning || !syncedSinceClosed));

      if (shouldSync) {
        const result = await runAutoSyncOnce({ ...options, apply: true });
        const skippedBecauseRunning = Boolean(result.skippedBecauseClaudeRunning);
        status.lastRunAt = new Date().toISOString();
        status.lastError = null;
        status.lastSummary = {
          written: result.written.length,
          archived: result.archived.length,
          reconciled: result.reconciled.length,
          skipped: result.skipped.length,
        };

        if (!skippedBecauseRunning) {
          pendingSync = false;
          status.pending = false;
          syncedSinceClosed = true;
        }
        logger?.debug?.(status.lastSummary, 'Claude Desktop auto-sync pass completed');
      }

      if (claudeRunning) {
        syncedSinceClosed = false;
      }
      wasClaudeRunning = claudeRunning;
    } catch (error) {
      recordError(error);
    } finally {
      status.running = false;
      schedule(intervalMs);
    }
  };

  const requestSync = async (reason = 'manual'): Promise<ClaudeDesktopAutoSyncStatus> => {
    if (!enabled || stopped) {
      return cloneStatus(status);
    }

    pendingSync = true;
    status.pending = true;
    status.lastRequestedAt = new Date().toISOString();
    status.lastRequestReason = reason;

    try {
      if (!await ensureStarted()) {
        return cloneStatus(status);
      }
      clearScheduled();
      if (!active) {
        active = tick().finally(() => {
          active = null;
        });
      }
      await active;
    } catch (error) {
      recordError(error);
    }

    return cloneStatus(status);
  };

  const ready = (async () => {
    if (!enabled) {
      logger?.info?.('Claude Desktop auto-sync disabled by environment');
      return cloneStatus(status);
    }

    try {
      if (await ensureStarted()) {
        schedule(0);
      }
    } catch (error) {
      recordError(error);
    }

    return cloneStatus(status);
  })();

  return {
    ready,
    getStatus: () => cloneStatus(status),
    stop: async () => {
      stopped = true;
      status.stopped = true;
      clearScheduled();
      await active;
    },
    requestSync,
  };
}
