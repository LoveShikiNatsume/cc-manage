// @ts-nocheck
import { backupSingleMetadataFile } from "./backup.js";
import { collectCliSessions } from "./cli-sessions.js";
import {
  defaultApiDesktopRoots,
  defaultSubscriptionDesktopRoots
} from "./constants.js";
import { collectDesktopSessions } from "./desktop-sessions.js";
import { writeJsonFileAtomic } from "./fs-util.js";
import { normalizeComparablePath } from "./locality.js";
import { withClaudeJsonlWriteLock } from "../claude-jsonl-lock.js";

const MAX_CREATED_AT_DRIFT_MS = 5 * 60 * 1000;

function hasCliSessionId(session) {
  return typeof session.cliSessionId === "string" && session.cliSessionId.length > 0;
}

function matchScore(desktopSession, cliSession) {
  const desktopCwd = normalizeComparablePath(desktopSession.cwd ?? desktopSession.originCwd);
  const cliCwd = normalizeComparablePath(cliSession.cwd);
  if (!desktopCwd || !cliCwd || desktopCwd !== cliCwd) {
    return null;
  }
  if (typeof desktopSession.createdAtMs !== "number" || typeof cliSession.createdAtMs !== "number") {
    return null;
  }
  const drift = Math.abs(desktopSession.createdAtMs - cliSession.createdAtMs);
  return drift <= MAX_CREATED_AT_DRIFT_MS ? drift : null;
}

/**
 * Pure matcher: given Desktop session records (some possibly missing cliSessionId)
 * and the CLI sessions discovered on disk, find an unambiguous (cwd + creation time)
 * pairing for each broken Desktop record. Never guesses when more than one CLI
 * session fits equally well.
 */
export function planCliSessionIdRepairs({ desktopSessions, cliSessions }) {
  const claimedCliIds = new Set(
    desktopSessions.filter(hasCliSessionId).map((session) => session.cliSessionId)
  );
  const availableCliSessions = cliSessions.filter((session) => !claimedCliIds.has(session.sessionId));
  const broken = desktopSessions.filter((session) => !hasCliSessionId(session));

  const usedCliIds = new Set();
  const repairs = [];
  const unresolved = [];

  for (const desktopSession of broken) {
    const scored = availableCliSessions
      .filter((cliSession) => !usedCliIds.has(cliSession.sessionId))
      .map((cliSession) => ({ cliSession, score: matchScore(desktopSession, cliSession) }))
      .filter((entry) => entry.score !== null)
      .sort((a, b) => a.score - b.score);

    if (scored.length === 0) {
      unresolved.push({
        desktopSession,
        reason: "No CLI session matched by working directory and creation time"
      });
      continue;
    }
    if (scored.length > 1 && scored[0].score === scored[1].score) {
      unresolved.push({
        desktopSession,
        reason: "Multiple CLI sessions matched equally well; refusing to guess"
      });
      continue;
    }

    usedCliIds.add(scored[0].cliSession.sessionId);
    repairs.push({
      desktopSession,
      cliSessionId: scored[0].cliSession.sessionId,
      driftMs: scored[0].score
    });
  }

  return { repairs, unresolved };
}

export async function applyCliSessionIdRepairs({ claudeHome, desktopSessions, cliSessions }) {
  const { repairs, unresolved } = planCliSessionIdRepairs({ desktopSessions, cliSessions });
  const repaired = [];

  for (const repair of repairs) {
    const backupPath = await backupSingleMetadataFile({
      claudeHome,
      filePath: repair.desktopSession.filePath,
      reason: "cli-session-id-repair"
    });
    const raw = { ...repair.desktopSession.raw, cliSessionId: repair.cliSessionId };
    await writeJsonFileAtomic(repair.desktopSession.filePath, raw);
    repaired.push({
      filePath: repair.desktopSession.filePath,
      cliSessionId: repair.cliSessionId,
      driftMs: repair.driftMs,
      backupPath
    });
  }

  return {
    repaired,
    unresolved: unresolved.map((item) => ({
      filePath: item.desktopSession.filePath,
      title: item.desktopSession.title,
      cwd: item.desktopSession.cwd,
      reason: item.reason
    }))
  };
}

async function repairDesktopSessionMetadataUnlocked(options = {}) {
  const cli = await collectCliSessions(options);
  const apiDesktop = await collectDesktopSessions({ ...options, desktopRoots: defaultApiDesktopRoots() });
  const subscriptionDesktop = await collectDesktopSessions({
    ...options,
    desktopRoots: defaultSubscriptionDesktopRoots()
  });

  const api = await applyCliSessionIdRepairs({
    claudeHome: cli.claudeHome,
    desktopSessions: apiDesktop.sessions,
    cliSessions: cli.sessions
  });
  const subscription = await applyCliSessionIdRepairs({
    claudeHome: cli.claudeHome,
    desktopSessions: subscriptionDesktop.sessions,
    cliSessions: cli.sessions
  });

  return {
    repaired: [...api.repaired, ...subscription.repaired],
    unresolved: [...api.unresolved, ...subscription.unresolved]
  };
}

export async function repairDesktopSessionMetadata(options = {}) {
  return withClaudeJsonlWriteLock(() => repairDesktopSessionMetadataUnlocked(options));
}
