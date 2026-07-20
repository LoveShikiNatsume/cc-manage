// @ts-nocheck
import fs from "node:fs/promises";
import path from "node:path";

import { defaultDesktopRoots } from "./constants.js";
import { listFilesRecursive, pathExists, readJsonIfPresent } from "./fs-util.js";

function normalizeRoot(root) {
  return path.resolve(root);
}

function toMillis(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function isDesktopSessionFile(filePath, entry) {
  return entry.name.startsWith("local_") && entry.name.endsWith(".json");
}

async function summarizeDesktopRoot(root) {
  const normalizedRoot = normalizeRoot(root);
  const present = await pathExists(normalizedRoot);
  const config = await readJsonIfPresent(path.join(normalizedRoot, "claude_desktop_config.json"));
  const appConfig = await readJsonIfPresent(path.join(normalizedRoot, "config.json"));
  const sessionsRoot = path.join(normalizedRoot, "claude-code-sessions");
  const sessionFiles = present
    ? await listFilesRecursive(sessionsRoot, isDesktopSessionFile)
    : [];

  const sessions = [];
  const errors = [];
  for (const filePath of sessionFiles) {
    try {
      const data = JSON.parse(await fs.readFile(filePath, "utf8"));
      const stat = await fs.stat(filePath);
      sessions.push({
        root: normalizedRoot,
        filePath,
        scopeDir: path.dirname(filePath),
        sessionId: data.sessionId ?? path.basename(filePath, ".json"),
        cliSessionId: data.cliSessionId ?? null,
        cwd: data.cwd ?? data.originCwd ?? null,
        originCwd: data.originCwd ?? data.cwd ?? null,
        model: data.model ?? null,
        effort: data.effort ?? null,
        isArchived: Boolean(data.isArchived),
        title: data.title ?? null,
        titleSource: data.titleSource ?? null,
        completedTurns: Number(data.completedTurns) || 0,
        createdAtMs: toMillis(data.createdAt) ?? stat.birthtimeMs,
        lastActivityAtMs: toMillis(data.lastActivityAt) ?? stat.mtimeMs,
        lastFocusedAtMs: toMillis(data.lastFocusedAt) ?? null,
        fileMtimeMs: stat.mtimeMs,
        keys: Object.keys(data),
        raw: data
      });
    } catch (error) {
      errors.push({ filePath, error: error.message });
    }
  }

  sessions.sort((left, right) => (right.lastActivityAtMs ?? 0) - (left.lastActivityAtMs ?? 0));
  const lastKnownAccountUuid = typeof appConfig?.lastKnownAccountUuid === "string" && appConfig.lastKnownAccountUuid
    ? appConfig.lastKnownAccountUuid
    : null;
  return {
    root: normalizedRoot,
    present,
    configPresent: config !== null,
    appConfigPresent: appConfig !== null,
    lastKnownAccountUuid,
    sessionsRoot,
    sessionCount: sessions.length,
    sessions,
    errors
  };
}

export async function collectDesktopSessions(options = {}) {
  const roots = (options.desktopRoot
    ? [options.desktopRoot]
    : (options.desktopRoots ?? defaultDesktopRoots()))
    .map(normalizeRoot);

  const summaries = [];
  for (const root of roots) {
    summaries.push(await summarizeDesktopRoot(root));
  }
  const sessions = summaries.flatMap((summary) => summary.sessions);
  return {
    roots: summaries,
    sessions
  };
}

function accountUuidForScope(scope) {
  const sessionsRoot = path.join(scope.desktopRoot, "claude-code-sessions");
  const rel = path.relative(sessionsRoot, scope.scopeDir);
  const [orgUuid] = rel.split(path.sep);
  return orgUuid || null;
}

// Every distinct <org>/<user> scope directory seen under this root collection,
// restricted to the account(s) Desktop itself last reported as active
// (config.json's lastKnownAccountUuid) when that signal is available. A user can
// be logged into more than one account on the same root set, and only one of
// them is the one they're actually looking at right now -- writing into an
// account they haven't opened in weeks just scatters data they'll never see.
// Falls back to the single most-recently-active scope when no account signal
// is available at all.
export function listDesktopWriteScopes(desktopSummary) {
  const activeAccountUuids = new Set(
    desktopSummary.roots
      .map((root) => root.lastKnownAccountUuid)
      .filter((uuid) => typeof uuid === "string" && uuid)
  );

  const byScopeDir = new Map();
  const sessionsByRecency = desktopSummary.sessions
    .slice()
    .sort((left, right) => (right.lastActivityAtMs ?? 0) - (left.lastActivityAtMs ?? 0));
  for (const session of sessionsByRecency) {
    if (!session.scopeDir || byScopeDir.has(session.scopeDir)) {
      continue;
    }
    byScopeDir.set(session.scopeDir, {
      desktopRoot: session.root,
      scopeDir: session.scopeDir,
      template: session.raw
    });
  }

  if (byScopeDir.size === 0) {
    const presentRoot = desktopSummary.roots.find((root) => root.present && root.sessionsRoot);
    return presentRoot
      ? [{ desktopRoot: presentRoot.root, scopeDir: null, template: null }]
      : [];
  }

  const allScopes = [...byScopeDir.values()];
  if (activeAccountUuids.size === 0) {
    return [allScopes[0]];
  }

  const activeScopes = allScopes.filter((scope) => activeAccountUuids.has(accountUuidForScope(scope)));
  return activeScopes.length > 0 ? activeScopes : [allScopes[0]];
}

export function chooseDesktopWriteScope(desktopSummary) {
  return listDesktopWriteScopes(desktopSummary)[0] ?? null;
}
