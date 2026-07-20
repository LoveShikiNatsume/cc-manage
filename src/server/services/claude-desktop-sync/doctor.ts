// @ts-nocheck
import path from "node:path";

import { collectCliSessions } from "./cli-sessions.js";
import {
  chooseDesktopWriteScope,
  collectDesktopSessions,
  listDesktopWriteScopes
} from "./desktop-sessions.js";
import { planCliSessionIdRepairs } from "./repair.js";
import { resolveTitleFromCandidates } from "../session-parser.js";

function normalizeComparablePath(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  return path.resolve(value).replace(/[\\/]+$/, "").toLowerCase();
}

function summarizeByProject(sessions) {
  const counts = new Map();
  for (const session of sessions) {
    const key = normalizeComparablePath(session.cwd) ?? "(unknown)";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([project, count]) => ({ project, count }));
}

function isSubscriptionDesktopSession(session) {
  return session.entrypoints?.includes("claude-desktop");
}

function isApiDesktopSession(session) {
  return session.entrypoints?.includes("claude-desktop-3p");
}

export async function runDoctor(options = {}) {
  const cli = await collectCliSessions(options);
  const desktop = await collectDesktopSessions(options);
  const subscriptionJsonlSessions = cli.sessions.filter(isSubscriptionDesktopSession);
  const apiJsonlSessions = cli.sessions.filter(isApiDesktopSession);
  const desktopJsonlSessions = cli.sessions.filter((session) => (
    isSubscriptionDesktopSession(session) || isApiDesktopSession(session)
  ));
  const extensionOrSdkJsonlSessions = cli.sessions.filter((session) => !(
    isSubscriptionDesktopSession(session) || isApiDesktopSession(session)
  ));
  const desktopByCliSessionId = new Map(
    desktop.sessions
      .filter((session) => typeof session.cliSessionId === "string" && session.cliSessionId)
      .map((session) => [session.cliSessionId, session])
  );
  const cliBySessionId = new Map(cli.sessions.map((session) => [session.sessionId, session]));

  const missingDesktopSessions = cli.sessions
    .filter((session) => !desktopByCliSessionId.has(session.sessionId))
    .map((session) => ({
      sessionId: session.sessionId,
      cwd: session.cwd,
      model: session.model,
      lastActivityAtMs: session.lastActivityAtMs,
      userMessages: session.userMessages,
      assistantMessages: session.assistantMessages,
      filePath: session.filePath,
      suggestedTitle: resolveTitleFromCandidates([
        session.title,
        session.historyDisplay,
        session.firstPromptPreview,
        session.lastPromptPreview
      ])
    }));

  const orphanDesktopSessions = desktop.sessions
    .filter((session) => session.cliSessionId && !cliBySessionId.has(session.cliSessionId))
    .map((session) => ({
      sessionId: session.sessionId,
      cliSessionId: session.cliSessionId,
      cwd: session.cwd,
      model: session.model,
      filePath: session.filePath
    }));

  const writeScope = chooseDesktopWriteScope(desktop);
  const writeScopes = listDesktopWriteScopes(desktop);
  const cliSessionIdRepairPlan = planCliSessionIdRepairs({
    desktopSessions: desktop.sessions,
    cliSessions: cli.sessions
  });
  return {
    cli: {
      claudeHome: cli.claudeHome,
      statePath: cli.statePath,
      projectsDir: cli.projectsDir,
      sessionCount: cli.sessions.length,
      desktopJsonlSessionCount: desktopJsonlSessions.length,
      apiOrExtensionJsonlSessionCount: extensionOrSdkJsonlSessions.length,
      subscriptionJsonlSessionCount: subscriptionJsonlSessions.length,
      apiJsonlSessionCount: apiJsonlSessions.length,
      extensionOrSdkJsonlSessionCount: extensionOrSdkJsonlSessions.length,
      projectState: cli.projectStateSummary,
      byProject: summarizeByProject(cli.sessions),
      desktopJsonlSessions: desktopJsonlSessions.map((session) => ({
        sessionId: session.sessionId,
        cwd: session.cwd,
        model: session.model,
        entrypoints: session.entrypoints,
        title: resolveTitleFromCandidates([session.title, session.historyDisplay, session.firstPromptPreview]),
        lastActivityAtMs: session.lastActivityAtMs,
        filePath: session.filePath
      })),
      subscriptionJsonlSessions: subscriptionJsonlSessions.map((session) => ({
        sessionId: session.sessionId,
        cwd: session.cwd,
        model: session.model,
        entrypoints: session.entrypoints,
        title: resolveTitleFromCandidates([session.title, session.historyDisplay, session.firstPromptPreview]),
        lastActivityAtMs: session.lastActivityAtMs,
        filePath: session.filePath
      })),
      apiJsonlSessions: apiJsonlSessions.map((session) => ({
        sessionId: session.sessionId,
        cwd: session.cwd,
        model: session.model,
        entrypoints: session.entrypoints,
        title: resolveTitleFromCandidates([session.title, session.historyDisplay, session.firstPromptPreview]),
        lastActivityAtMs: session.lastActivityAtMs,
        filePath: session.filePath
      }))
    },
    desktop: {
      roots: desktop.roots.map((root) => ({
        root: root.root,
        present: root.present,
        configPresent: root.configPresent,
        appConfigPresent: root.appConfigPresent,
        sessionsRoot: root.sessionsRoot,
        sessionCount: root.sessionCount,
        errors: root.errors
      })),
      sessionCount: desktop.sessions.length,
      metadataSessionCount: desktop.sessions.length,
      byProject: summarizeByProject(desktop.sessions)
    },
    missingDesktopSessions,
    orphanDesktopSessions,
    repairableDesktopSessions: cliSessionIdRepairPlan.repairs.map((repair) => ({
      filePath: repair.desktopSession.filePath,
      title: repair.desktopSession.title,
      cwd: repair.desktopSession.cwd,
      candidateCliSessionId: repair.cliSessionId,
      driftMs: repair.driftMs
    })),
    unrepairableDesktopSessions: cliSessionIdRepairPlan.unresolved.map((item) => ({
      filePath: item.desktopSession.filePath,
      title: item.desktopSession.title,
      cwd: item.desktopSession.cwd,
      reason: item.reason
    })),
    writeScope: writeScope
      ? {
          desktopRoot: writeScope.desktopRoot,
          scopeDir: writeScope.scopeDir,
          hasTemplate: Boolean(writeScope.template)
        }
      : null,
    writeScopes: writeScopes.map((scope) => ({
      desktopRoot: scope.desktopRoot,
      scopeDir: scope.scopeDir
    }))
  };
}
