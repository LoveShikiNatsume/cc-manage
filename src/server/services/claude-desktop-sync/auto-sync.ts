// @ts-nocheck
import fs from "node:fs/promises";
import path from "node:path";

import { collectCliSessions } from "./cli-sessions.js";
import {
  defaultApiDesktopRoots,
  defaultBackupRoot,
  defaultSubscriptionDesktopRoots
} from "./constants.js";
import { collectDesktopSessions } from "./desktop-sessions.js";
import { writeJsonFileAtomic } from "./fs-util.js";
import { localWorkspaceReason } from "./locality.js";
import { isClaudeDesktopRunning } from "./process-state.js";
import { applyCliSessionIdRepairs } from "./repair.js";
import { runSync } from "./sync.js";
import { loadSyncState, saveSyncState } from "./state.js";
import { withClaudeJsonlWriteLock } from "../claude-jsonl-lock.js";

function byCliSessionId(sessions) {
  return new Map(
    sessions
      .filter((session) => typeof session.cliSessionId === "string" && session.cliSessionId)
      .map((session) => [session.cliSessionId, session])
  );
}

function newestMetadata(left, right) {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return (right.fileMtimeMs ?? 0) > (left.fileMtimeMs ?? 0) ? right : left;
}

function metadataPatchFromSource(source, cliSession) {
  const patch = {};
  if (source.title) {
    patch.title = source.title;
    patch.titleSource = source.titleSource ?? "user";
  }
  if (source.isArchived !== undefined) {
    patch.isArchived = Boolean(source.isArchived);
  }
  return patch;
}

function applyPatch(raw, patch) {
  const next = { ...raw };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined && value !== null) {
      next[key] = value;
    }
  }
  return next;
}

function differs(raw, patch) {
  return Object.entries(patch).some(([key, value]) => value !== undefined && value !== null && raw?.[key] !== value);
}

async function writeMetadata(session, raw, written) {
  await writeJsonFileAtomic(session.filePath, raw);
  written.push(session.filePath);
}

async function backupMetadataFile({ claudeHome, session, reason }) {
  const backupRoot = defaultBackupRoot(claudeHome);
  const backupDir = path.join(backupRoot, "auto-sync-deletes", new Date().toISOString().replace(/[-:.]/g, ""));
  await fs.mkdir(backupDir, { recursive: true });
  const target = path.join(backupDir, `${reason}-${path.basename(session.filePath)}`);
  await fs.copyFile(session.filePath, target);
  return target;
}

function snapshotSide(session) {
  if (!session) {
    return null;
  }
  return {
    filePath: session.filePath,
    root: session.root,
    title: session.title ?? null,
    isArchived: Boolean(session.isArchived),
    fileMtimeMs: session.fileMtimeMs ?? null,
    seenAtMs: Date.now()
  };
}

function isKnownPresent(previous, side) {
  return Boolean(previous?.[side]?.filePath) && !previous?.tombstone;
}

function deletionReason(previous, apiSession, subscriptionSession) {
  if (!previous) {
    return null;
  }
  if (isKnownPresent(previous, "api") && !apiSession && subscriptionSession) {
    return { deletedSide: "api", remainingSide: "subscription", remainingSession: subscriptionSession };
  }
  if (isKnownPresent(previous, "subscription") && !subscriptionSession && apiSession) {
    return { deletedSide: "subscription", remainingSide: "api", remainingSession: apiSession };
  }
  return null;
}

async function archiveDeletedCliSession({ claudeHome, sessionId, apiSession, subscriptionSession, written, archived }) {
  for (const [side, session] of [
    ["api", apiSession],
    ["subscription", subscriptionSession]
  ]) {
    if (!session || session.isArchived) {
      continue;
    }

    await backupMetadataFile({
      claudeHome,
      session,
      reason: `cli-deleted-${side}`
    });
    const raw = {
      ...session.raw,
      isArchived: true,
      lastActivityAt: Math.max(session.lastActivityAtMs ?? 0, Date.now())
    };
    await writeMetadata(session, raw, written);
    archived.push({ sessionId, deletedSide: "cli", archivedSide: side });
  }
}

async function runAutoSyncOnceUnlocked(options = {}) {
  if (!options.syncWhileRunning && await isClaudeDesktopRunning()) {
    return {
      skippedBecauseClaudeRunning: true,
      statePath: null,
      written: [],
      archived: [],
      reconciled: [],
      skipped: [],
      repaired: [],
      unresolvedRepairs: [],
      apiResult: null,
      subscriptionResult: null
    };
  }
  const cli = await collectCliSessions(options);
  const state = await loadSyncState({ ...options, claudeHome: cli.claudeHome });
  let apiDesktop = await collectDesktopSessions({ ...options, desktopRoots: defaultApiDesktopRoots() });
  let subscriptionDesktop = await collectDesktopSessions({ ...options, desktopRoots: defaultSubscriptionDesktopRoots() });

  const apiRepair = await applyCliSessionIdRepairs({
    claudeHome: cli.claudeHome,
    desktopSessions: apiDesktop.sessions,
    cliSessions: cli.sessions
  });
  const subscriptionRepair = await applyCliSessionIdRepairs({
    claudeHome: cli.claudeHome,
    desktopSessions: subscriptionDesktop.sessions,
    cliSessions: cli.sessions
  });
  const repaired = [...apiRepair.repaired, ...subscriptionRepair.repaired];
  const unresolvedRepairs = [...apiRepair.unresolved, ...subscriptionRepair.unresolved];
  if (apiRepair.repaired.length > 0) {
    apiDesktop = await collectDesktopSessions({ ...options, desktopRoots: defaultApiDesktopRoots() });
  }
  if (subscriptionRepair.repaired.length > 0) {
    subscriptionDesktop = await collectDesktopSessions({ ...options, desktopRoots: defaultSubscriptionDesktopRoots() });
  }

  const apiByCli = byCliSessionId(apiDesktop.sessions);
  const subscriptionByCli = byCliSessionId(subscriptionDesktop.sessions);
  const cliById = new Map(cli.sessions.map((session) => [session.sessionId, session]));
  const allSessionIds = new Set([
    ...cliById.keys(),
    ...apiByCli.keys(),
    ...subscriptionByCli.keys(),
    ...Object.keys(state.data.sessions)
  ]);

  const excludeSessionIds = new Set(Object.keys(state.data.tombstones ?? {}));
  const written = [];
  const archived = [];
  const skipped = [];

  for (const [sessionId, tombstone] of Object.entries(state.data.tombstones ?? {})) {
    if (tombstone?.deletedSide !== "cli") {
      continue;
    }
    await archiveDeletedCliSession({
      claudeHome: cli.claudeHome,
      sessionId,
      apiSession: apiByCli.get(sessionId),
      subscriptionSession: subscriptionByCli.get(sessionId),
      written,
      archived
    });
    excludeSessionIds.add(sessionId);
  }

  for (const sessionId of allSessionIds) {
    const cliSession = cliById.get(sessionId);
    const apiSession = apiByCli.get(sessionId);
    const subscriptionSession = subscriptionByCli.get(sessionId);
    if (!cliSession) {
      continue;
    }
    const reason = localWorkspaceReason({
      cliSession,
      sourceDesktopSession: newestMetadata(apiSession, subscriptionSession)
    });
    if (reason) {
      skipped.push({ sessionId, reason });
      continue;
    }

    const deletion = deletionReason(state.data.sessions[sessionId], apiSession, subscriptionSession);
    if (deletion) {
      await backupMetadataFile({
        claudeHome: cli.claudeHome,
        session: deletion.remainingSession,
        reason: `${deletion.deletedSide}-deleted`
      });
      const raw = {
        ...deletion.remainingSession.raw,
        isArchived: true,
        lastActivityAt: Math.max(deletion.remainingSession.lastActivityAtMs ?? 0, Date.now())
      };
      await writeMetadata(deletion.remainingSession, raw, written);
      archived.push({ sessionId, deletedSide: deletion.deletedSide, archivedSide: deletion.remainingSide });
      state.data.tombstones[sessionId] = {
        deletedSide: deletion.deletedSide,
        createdAt: new Date().toISOString()
      };
      excludeSessionIds.add(sessionId);
    }
  }

  const apiResult = await runSync({
    ...options,
    target: "api-view",
    apply: true,
    excludeSessionIds
  });
  const subscriptionResult = await runSync({
    ...options,
    target: "subscription-view",
    apply: true,
    excludeSessionIds
  });
  written.push(...apiResult.written, ...subscriptionResult.written);

  const refreshedApi = await collectDesktopSessions({ ...options, desktopRoots: defaultApiDesktopRoots() });
  const refreshedSubscription = await collectDesktopSessions({ ...options, desktopRoots: defaultSubscriptionDesktopRoots() });
  const refreshedApiByCli = byCliSessionId(refreshedApi.sessions);
  const refreshedSubscriptionByCli = byCliSessionId(refreshedSubscription.sessions);
  const reconciled = [];

  for (const [sessionId, cliSession] of cliById) {
    if (excludeSessionIds.has(sessionId)) {
      continue;
    }
    const apiSession = refreshedApiByCli.get(sessionId);
    const subscriptionSession = refreshedSubscriptionByCli.get(sessionId);
    if (!apiSession || !subscriptionSession) {
      continue;
    }
    const reason = localWorkspaceReason({
      cliSession,
      sourceDesktopSession: newestMetadata(apiSession, subscriptionSession)
    });
    if (reason) {
      continue;
    }
    const source = newestMetadata(apiSession, subscriptionSession);
    const patch = metadataPatchFromSource(source, cliSession);
    for (const target of [apiSession, subscriptionSession]) {
      if (!differs(target.raw, patch)) {
        continue;
      }
      await writeMetadata(target, applyPatch(target.raw, patch), written);
      reconciled.push({ sessionId, targetPath: target.filePath });
    }
  }

  const finalApi = await collectDesktopSessions({ ...options, desktopRoots: defaultApiDesktopRoots() });
  const finalSubscription = await collectDesktopSessions({ ...options, desktopRoots: defaultSubscriptionDesktopRoots() });
  const finalApiByCli = byCliSessionId(finalApi.sessions);
  const finalSubscriptionByCli = byCliSessionId(finalSubscription.sessions);
  const nextSessions = {};
  for (const sessionId of allSessionIds) {
    if (state.data.tombstones[sessionId]) {
      continue;
    }
    const apiSession = finalApiByCli.get(sessionId);
    const subscriptionSession = finalSubscriptionByCli.get(sessionId);
    if (!apiSession && !subscriptionSession) {
      continue;
    }
    nextSessions[sessionId] = {
      api: snapshotSide(apiSession),
      subscription: snapshotSide(subscriptionSession),
      updatedAt: new Date().toISOString()
    };
  }
  state.data.sessions = nextSessions;
  await saveSyncState(state.path, state.data);

  return {
    statePath: state.path,
    written,
    archived,
    reconciled,
    skipped,
    repaired,
    unresolvedRepairs,
    apiResult,
    subscriptionResult
  };
}

export async function runAutoSyncOnce(options = {}) {
  return withClaudeJsonlWriteLock(() => runAutoSyncOnceUnlocked(options));
}

export async function watchAutoSync(options = {}) {
  const intervalMs = Math.max(1000, Number(options.intervalMs ?? 5000));
  const syncWhileRunning = Boolean(options.syncWhileRunning);
  let running = true;
  let pass = 0;
  let wasClaudeRunning = await isClaudeDesktopRunning();
  let syncedSinceClosed = false;
  const stop = () => {
    running = false;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  while (running) {
    pass += 1;
    const claudeRunning = await isClaudeDesktopRunning();
    const shouldSync = syncWhileRunning
      || (!claudeRunning && (wasClaudeRunning || !syncedSinceClosed));
    try {
      if (shouldSync) {
        const result = await runAutoSyncOnce(options);
        const changed = result.written.length + result.archived.length + result.reconciled.length + result.repaired.length;
        syncedSinceClosed = true;
        console.log(`[${new Date().toISOString()}] pass=${pass} claude=closed changed=${changed} written=${result.written.length} archived=${result.archived.length} repaired=${result.repaired.length}`);
      } else {
        console.log(`[${new Date().toISOString()}] pass=${pass} claude=${claudeRunning ? "running" : "closed"} waiting`);
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}] sync failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (claudeRunning) {
      syncedSinceClosed = false;
    }
    wasClaudeRunning = claudeRunning;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
