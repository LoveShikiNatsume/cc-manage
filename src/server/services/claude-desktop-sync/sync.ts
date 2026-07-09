// @ts-nocheck
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { createBackup } from "./backup.js";
import { collectCliSessions } from "./cli-sessions.js";
import {
  defaultApiDesktopRoots,
  defaultSubscriptionDesktopRoots
} from "./constants.js";
import {
  chooseDesktopWriteScope,
  collectDesktopSessions
} from "./desktop-sessions.js";
import {
  localWorkspaceReason,
  normalizeComparablePath
} from "./locality.js";
import { withClaudeJsonlWriteLock } from "../claude-jsonl-lock.js";

function nowMs() {
  return Date.now();
}

function localSessionId() {
  return `local_${crypto.randomUUID()}`;
}

function titleFromSession(session) {
  for (const candidate of [
    session.title,
    session.historyDisplay,
    session.firstPromptPreview,
    session.lastPromptPreview
  ]) {
    if (typeof candidate === "string" && candidate.trim() && !candidate.trim().startsWith("/")) {
      return candidate;
    }
  }
  return `Imported CLI session ${session.sessionId.slice(0, 8)}`;
}

function hasEntrypoint(session, entrypoint) {
  return Array.isArray(session.entrypoints) && session.entrypoints.includes(entrypoint);
}

function buildDesktopSessionMetadata({ cliSession, template, options = {} }) {
  const current = nowMs();
  const model = options.model ?? cliSession.model ?? template?.model ?? null;
  const effort = options.effort ?? template?.effort ?? null;
  const createdAt = Math.trunc(cliSession.createdAtMs ?? cliSession.fileMtimeMs ?? current);
  const lastActivityAt = Math.trunc(cliSession.lastActivityAtMs ?? cliSession.fileMtimeMs ?? current);

  const result = {
    sessionId: localSessionId(),
    cliSessionId: cliSession.sessionId,
    cwd: cliSession.cwd,
    originCwd: cliSession.cwd,
    lastFocusedAt: current,
    createdAt,
    lastActivityAt,
    isArchived: false,
    title: titleFromSession(cliSession),
    titleSource: "imported",
    completedTurns: Math.max(cliSession.assistantMessages, cliSession.userMessages, 0),
    classifierSummaryEnabled: false,
    spawnSeed: {}
  };

  if (model) {
    result.model = model;
  }
  if (effort) {
    result.effort = effort;
  }
  for (const key of [
    "permissionMode",
    "enabledMcpTools",
    "remoteMcpServersConfig",
    "chromePermissionMode",
    "alwaysAllowedReasons",
    "sessionPermissionUpdates"
  ]) {
    if (template?.[key] !== undefined) {
      result[key] = template[key];
    }
  }
  if (result.remoteMcpServersConfig === undefined) {
    result.remoteMcpServersConfig = [];
  }
  if (result.alwaysAllowedReasons === undefined) {
    result.alwaysAllowedReasons = [];
  }
  if (result.sessionPermissionUpdates === undefined) {
    result.sessionPermissionUpdates = [];
  }
  return result;
}

function desiredRefreshFields(cliSession, options = {}) {
  const desired = {
    cwd: cliSession.cwd,
    originCwd: cliSession.cwd,
    lastActivityAt: Math.trunc(cliSession.lastActivityAtMs ?? cliSession.fileMtimeMs ?? nowMs()),
    completedTurns: Math.max(cliSession.assistantMessages, cliSession.userMessages, 0)
  };
  const model = options.model ?? cliSession.model ?? null;
  if (model) {
    desired.model = model;
  }
  const title = titleFromSession(cliSession);
  if (title) {
    desired.title = title;
    desired.titleSource = cliSession.titleSource ?? "imported";
  }
  return desired;
}

function buildUpdatedDesktopSessionMetadata({ cliSession, desktopSession, options = {} }) {
  const current = { ...desktopSession.raw };
  const desired = desiredRefreshFields(cliSession, options);
  for (const [key, value] of Object.entries(desired)) {
    if (value !== undefined && value !== null) {
      current[key] = value;
    }
  }
  current.cliSessionId = cliSession.sessionId;
  current.sessionId = desktopSession.sessionId;
  return current;
}

function needsRefresh({ cliSession, desktopSession, options = {} }) {
  const desired = desiredRefreshFields(cliSession, options);
  if (typeof desired.lastActivityAt === "number"
      && typeof desktopSession.lastActivityAtMs === "number"
      && desired.lastActivityAt > desktopSession.lastActivityAtMs) {
    return true;
  }
  if (desired.cwd && normalizeComparablePath(desired.cwd) !== normalizeComparablePath(desktopSession.cwd)) {
    return true;
  }
  if (desired.model && desired.model !== desktopSession.model) {
    return true;
  }
  if (desired.completedTurns && desired.completedTurns !== desktopSession.completedTurns) {
    return true;
  }
  if (desired.title && (!desktopSession.title || desktopSession.raw?.titleSource === "imported")) {
    return desired.title !== desktopSession.title;
  }
  return false;
}

function desktopRootsForTarget(target, options = {}) {
  if (options.desktopRoot || options.desktopRoots) {
    return options;
  }
  if (target === "subscription-view") {
    return { ...options, desktopRoots: defaultSubscriptionDesktopRoots() };
  }
  if (target === "api-view") {
    return { ...options, desktopRoots: defaultApiDesktopRoots() };
  }
  return options;
}

function sourceDesktopRootsForTarget(target, options = {}) {
  if (options.sourceDesktopRoot || options.sourceDesktopRoots) {
    return {
      ...options,
      desktopRoot: options.sourceDesktopRoot,
      desktopRoots: options.sourceDesktopRoots
    };
  }
  if (options.desktopRoot || options.desktopRoots) {
    return options;
  }
  if (target === "api-view") {
    return { ...options, desktopRoots: defaultSubscriptionDesktopRoots() };
  }
  if (target === "subscription-view") {
    return { ...options, desktopRoots: defaultApiDesktopRoots() };
  }
  return options;
}

function newestDesktopSessionByCliId(sessions) {
  const result = new Map();
  for (const session of sessions) {
    if (!session.cliSessionId) {
      continue;
    }
    const existing = result.get(session.cliSessionId);
    if (!existing || (session.fileMtimeMs ?? 0) > (existing.fileMtimeMs ?? 0)) {
      result.set(session.cliSessionId, session);
    }
  }
  return result;
}

export async function planSync(options = {}) {
  const cli = await collectCliSessions(options);
  const target = options.target ?? "api-view";
  const excludedSessionIds = new Set(options.excludeSessionIds ?? []);
  const desktop = await collectDesktopSessions(desktopRootsForTarget(target, options));
  const sourceDesktop = await collectDesktopSessions(sourceDesktopRootsForTarget(target, options));
  const desktopByCliId = newestDesktopSessionByCliId(desktop.sessions);
  const sourceDesktopByCliId = newestDesktopSessionByCliId(sourceDesktop.sessions);
  const writeScope = chooseDesktopWriteScope(desktop);

  const entrypointCandidateSessions = cli.sessions
    .filter((session) => !excludedSessionIds.has(session.sessionId))
    .filter((session) => {
      if (target === "api-view") {
        return hasEntrypoint(session, "claude-desktop");
      }
      if (target === "subscription-view") {
        return hasEntrypoint(session, "claude-desktop-3p");
      }
      return true;
    })
    .filter((session) => {
      if (!options.cwd) {
        return true;
      }
      return normalizeComparablePath(session.cwd) === normalizeComparablePath(options.cwd);
    });
  const skippedNonLocalSessions = [];
  const candidateSessions = [];
  for (const session of entrypointCandidateSessions) {
    const reason = localWorkspaceReason({
      cliSession: session,
      sourceDesktopSession: sourceDesktopByCliId.get(session.sessionId)
    });
    if (reason) {
      skippedNonLocalSessions.push({
        sessionId: session.sessionId,
        cwd: session.cwd,
        title: titleFromSession(session),
        reason
      });
      continue;
    }
    candidateSessions.push(session);
  }

  const limit = Number.isInteger(options.limit) && options.limit >= 0
    ? options.limit
    : candidateSessions.length;

  if (target === "subscription-view") {
    const selectedSessions = candidateSessions.slice(0, limit);
    const plannedWrites = [];
    for (const session of selectedSessions) {
      const existing = desktopByCliId.get(session.sessionId);
      if (existing) {
        if (!needsRefresh({ cliSession: session, desktopSession: existing, options })) {
          continue;
        }
        const metadata = buildUpdatedDesktopSessionMetadata({
          cliSession: session,
          desktopSession: existing,
          options
        });
        plannedWrites.push({
          action: "update",
          cliSessionId: session.sessionId,
          cwd: session.cwd,
          model: metadata.model ?? null,
          title: metadata.title,
          targetDir: path.dirname(existing.filePath),
          targetPath: existing.filePath,
          metadata,
        });
        continue;
      }

      const metadata = buildDesktopSessionMetadata({
        cliSession: session,
        template: writeScope?.template,
        options
      });
      const targetDir = writeScope?.scopeDir ?? null;
      plannedWrites.push({
        action: "create",
        cliSessionId: session.sessionId,
        cwd: session.cwd,
        model: metadata.model ?? null,
        title: metadata.title,
        targetDir,
        targetPath: targetDir ? path.join(targetDir, `${metadata.sessionId}.json`) : null,
        metadata,
      });
    }
    const createCount = plannedWrites.filter((write) => write.action.startsWith("create")).length;
    const updateCount = plannedWrites.filter((write) => write.action === "update").length;
    return {
      target,
      claudeHome: cli.claudeHome,
      writeScope,
      missingCount: candidateSessions.length,
      candidateCount: candidateSessions.length,
      upToDateCount: 0,
      createCount,
      updateCount,
      plannedWrites,
      skippedNonLocalCount: skippedNonLocalSessions.length,
      skippedNonLocalSessions,
      blockedReason: writeScope?.scopeDir
        ? null
        : "No existing subscription Claude Desktop claude-code-sessions scope was found. Open Claude Desktop subscription view once, then run status again."
    };
  }

  const plannedWrites = [];
  let upToDateCount = 0;
  for (const session of candidateSessions) {
    const existing = desktopByCliId.get(session.sessionId);
    if (existing) {
      if (!needsRefresh({ cliSession: session, desktopSession: existing, options })) {
        upToDateCount += 1;
        continue;
      }
      const metadata = buildUpdatedDesktopSessionMetadata({
        cliSession: session,
        desktopSession: existing,
        options
      });
      plannedWrites.push({
        action: "update",
        cliSessionId: session.sessionId,
        cwd: session.cwd,
        model: metadata.model ?? null,
        title: metadata.title,
        targetDir: path.dirname(existing.filePath),
        targetPath: existing.filePath,
        metadata
      });
      continue;
    }

    const metadata = buildDesktopSessionMetadata({
      cliSession: session,
      template: writeScope?.template,
      options
    });
    const targetDir = writeScope?.scopeDir ?? null;
    plannedWrites.push({
      action: "create",
      cliSessionId: session.sessionId,
      cwd: session.cwd,
      model: metadata.model ?? null,
      title: metadata.title,
      targetDir,
      targetPath: targetDir ? path.join(targetDir, `${metadata.sessionId}.json`) : null,
      metadata
    });
  }

  const selectedWrites = plannedWrites.slice(0, limit);
  const createCount = selectedWrites.filter((write) => write.action === "create").length;
  const updateCount = selectedWrites.filter((write) => write.action === "update").length;

  return {
    target,
    claudeHome: cli.claudeHome,
    writeScope,
    missingCount: candidateSessions.length,
    candidateCount: candidateSessions.length,
    upToDateCount,
    createCount,
    updateCount,
    plannedWrites: selectedWrites,
    skippedNonLocalCount: skippedNonLocalSessions.length,
    skippedNonLocalSessions,
    blockedReason: writeScope?.scopeDir
      ? null
      : "No existing Claude Desktop claude-code-sessions scope was found. Open Claude Desktop once, then run status again."
  };
}

async function runSyncUnlocked(options = {}) {
  const plan = await planSync(options);
  if (!options.apply) {
    return {
      ...plan,
      dryRun: true,
      backupDir: null,
      written: []
    };
  }
  if (plan.blockedReason) {
    throw new Error(plan.blockedReason);
  }
  if (plan.plannedWrites.length === 0) {
    return {
      ...plan,
      dryRun: false,
      backupDir: null,
      written: []
    };
  }

  if (plan.target === "subscription-view") {
    const backupDir = await createBackup({
      claudeHome: plan.claudeHome,
      desktopRoot: plan.writeScope.desktopRoot,
      scopeDir: plan.writeScope.scopeDir,
      plannedWrites: plan.plannedWrites.map((write) => ({
        action: write.action,
        cliSessionId: write.cliSessionId,
        targetPath: write.targetPath
      }))
    });
    const written = [];
    for (const write of plan.plannedWrites) {
      await fs.mkdir(path.dirname(write.targetPath), { recursive: true });
      await fs.writeFile(write.targetPath, `${JSON.stringify(write.metadata, null, 2)}\n`, "utf8");
      written.push(write.targetPath);
    }
    return {
      ...plan,
      dryRun: false,
      backupDir,
      written
    };
  }

  if (plan.target !== "api-view") {
    return {
      ...plan,
      dryRun: true,
      backupDir: null,
      written: [],
      blockedReason: `Unsupported sync target: ${plan.target}`
    };
  }

  const backupDir = await createBackup({
    claudeHome: plan.claudeHome,
    desktopRoot: plan.writeScope.desktopRoot,
    scopeDir: plan.writeScope.scopeDir,
    plannedWrites: plan.plannedWrites.map((write) => ({
      cliSessionId: write.cliSessionId,
      targetPath: write.targetPath
    }))
  });

  const written = [];
  for (const write of plan.plannedWrites) {
    await fs.mkdir(path.dirname(write.targetPath), { recursive: true });
    await fs.writeFile(write.targetPath, `${JSON.stringify(write.metadata, null, 2)}\n`, "utf8");
    written.push(write.targetPath);
  }

  return {
    ...plan,
    dryRun: false,
    backupDir,
    written
  };
}

export async function runSync(options = {}) {
  return withClaudeJsonlWriteLock(() => runSyncUnlocked(options));
}
