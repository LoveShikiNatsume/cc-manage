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
  return {
    root: normalizedRoot,
    present,
    configPresent: config !== null,
    appConfigPresent: appConfig !== null,
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

export function chooseDesktopWriteScope(desktopSummary) {
  const newestSession = desktopSummary.sessions
    .slice()
    .sort((left, right) => (right.lastActivityAtMs ?? 0) - (left.lastActivityAtMs ?? 0))[0];
  if (newestSession) {
    return {
      desktopRoot: newestSession.root,
      scopeDir: newestSession.scopeDir,
      template: newestSession.raw
    };
  }

  const presentRoot = desktopSummary.roots.find((root) => root.present && root.sessionsRoot);
  if (!presentRoot) {
    return null;
  }
  return {
    desktopRoot: presentRoot.root,
    scopeDir: null,
    template: null
  };
}
