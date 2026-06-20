// @ts-nocheck
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

import {
  defaultClaudeHome,
  defaultClaudeStatePath
} from "./constants.js";
import { readJsonIfPresent } from "./fs-util.js";
import {
  hasRemoteSessionMarker,
  isWindowsAbsolutePath
} from "./locality.js";

function toMillis(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function normalizePath(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const trimmed = value.trim();
  return isWindowsAbsolutePath(trimmed)
    ? path.win32.normalize(trimmed)
    : trimmed;
}

function basenameWithoutJsonl(filePath) {
  return path.basename(filePath).replace(/\.jsonl$/i, "");
}

function candidateModel(record) {
  return record?.model
    ?? record?.message?.model
    ?? record?.message?.usage?.model
    ?? record?.request?.model
    ?? null;
}

function candidateCwd(record) {
  return record?.cwd
    ?? record?.project
    ?? record?.workspace
    ?? null;
}

function candidateRemoteMarkers(record) {
  const markers = {};
  for (const key of [
    "sshConfig",
    "ssh_config",
    "remoteControl",
    "remote_control",
    "remoteControlSession",
    "remote_control_session",
    "remoteSession",
    "remote_session",
    "remoteWorkspace",
    "remote_workspace",
    "remoteEnv",
    "remote_env",
    "cloudEnvironment",
    "cloud_environment",
    "containerId",
    "container_id",
    "wslConfig",
    "wsl_config",
    "isClaudeCodeRemote"
  ]) {
    if (record?.[key] !== undefined) {
      markers[key] = record[key];
    }
  }
  for (const env of [record?.env, record?.message?.env, record?.request?.env]) {
    if (!env || typeof env !== "object") {
      continue;
    }
    if (env.is_claude_code_remote === true
        || env.isClaudeCodeRemote === true
        || typeof env.deployment_environment === "string") {
      markers.env = {
        is_claude_code_remote: env.is_claude_code_remote,
        isClaudeCodeRemote: env.isClaudeCodeRemote,
        deployment_environment: env.deployment_environment,
        platform: env.platform,
        platform_raw: env.platform_raw
      };
    }
  }
  return hasRemoteSessionMarker(markers) ? markers : null;
}

function candidateSessionId(record, filePath) {
  return record?.sessionId
    ?? record?.session_id
    ?? record?.conversationId
    ?? record?.conversation_id
    ?? basenameWithoutJsonl(filePath);
}

function previewDisplay(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
}

async function summarizeJsonlSession(filePath) {
  const stat = await fsp.stat(filePath);
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const summary = {
    sessionId: basenameWithoutJsonl(filePath),
    filePath,
    projectDir: path.dirname(filePath),
    cwd: null,
    model: null,
    version: null,
    entrypoint: null,
    entrypoints: [],
    title: null,
    titleSource: null,
    firstTimestampMs: null,
    lastTimestampMs: null,
    fileMtimeMs: stat.mtimeMs,
    fileSize: stat.size,
    lineCount: 0,
    userMessages: 0,
    assistantMessages: 0,
    queueOperations: 0,
    sidechainMessages: 0,
    firstPromptPreview: null,
    lastPromptPreview: null,
    remoteMarkers: null,
    parseErrors: 0
  };

  try {
    for await (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      summary.lineCount += 1;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        summary.parseErrors += 1;
        continue;
      }

      summary.sessionId = candidateSessionId(record, filePath) ?? summary.sessionId;
      summary.cwd = normalizePath(candidateCwd(record)) ?? summary.cwd;
      summary.model = candidateModel(record) ?? summary.model;
      summary.version = record?.version ?? summary.version;
      summary.remoteMarkers ??= candidateRemoteMarkers(record);
      if (record?.type === "custom-title" && typeof record.customTitle === "string" && record.customTitle.trim()) {
        summary.title = record.customTitle.trim();
        summary.titleSource = "custom-title";
      } else if (record?.type === "ai-title" && typeof record.aiTitle === "string" && record.aiTitle.trim() && !summary.title) {
        summary.title = record.aiTitle.trim();
        summary.titleSource = "ai-title";
      }
      if (typeof record?.entrypoint === "string" && record.entrypoint) {
        summary.entrypoint = record.entrypoint;
        if (!summary.entrypoints.includes(record.entrypoint)) {
          summary.entrypoints.push(record.entrypoint);
        }
      }
      if (record?.isSidechain) {
        summary.sidechainMessages += 1;
      }
      if (record?.type === "queue-operation") {
        summary.queueOperations += 1;
      }
      if (record?.type === "user" || record?.message?.role === "user") {
        summary.userMessages += 1;
        if (typeof record?.message?.content === "string") {
          const preview = previewDisplay(record.message.content);
          if (preview && !preview.startsWith("/")) {
            summary.firstPromptPreview ??= preview;
            summary.lastPromptPreview = preview;
          }
        }
      }
      if (record?.type === "assistant" || record?.message?.role === "assistant") {
        summary.assistantMessages += 1;
      }

      const ts = toMillis(record?.timestamp);
      if (ts !== null) {
        summary.firstTimestampMs = summary.firstTimestampMs === null ? ts : Math.min(summary.firstTimestampMs, ts);
        summary.lastTimestampMs = summary.lastTimestampMs === null ? ts : Math.max(summary.lastTimestampMs, ts);
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }

  summary.createdAtMs = summary.firstTimestampMs ?? stat.birthtimeMs ?? stat.ctimeMs;
  summary.lastActivityAtMs = summary.lastTimestampMs ?? stat.mtimeMs;
  summary.entrypoints.sort();
  return summary;
}

async function listProjectJsonlFiles(projectsDir) {
  let projectDirs;
  try {
    projectDirs = await fsp.readdir(projectsDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const files = [];
  for (const entry of projectDirs) {
    if (!entry.isDirectory()) {
      continue;
    }
    const projectDir = path.join(projectsDir, entry.name);
    const children = await fsp.readdir(projectDir, { withFileTypes: true });
    for (const child of children) {
      if (child.isFile() && child.name.endsWith(".jsonl")) {
        files.push(path.join(projectDir, child.name));
      }
    }
  }
  return files;
}

async function readHistoryBySession(claudeHome) {
  const historyPath = path.join(claudeHome, "history.jsonl");
  const bySession = new Map();
  try {
    await fsp.access(historyPath);
  } catch {
    return bySession;
  }

  const stream = fs.createReadStream(historyPath, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      try {
        const record = JSON.parse(line);
        if (typeof record.sessionId !== "string" || !record.sessionId) {
          continue;
        }
        const previous = bySession.get(record.sessionId) ?? {};
        bySession.set(record.sessionId, {
          ...previous,
          sessionId: record.sessionId,
          project: normalizePath(record.project) ?? previous.project ?? null,
          timestampMs: toMillis(record.timestamp) ?? previous.timestampMs ?? null,
          display: previewDisplay(record.display) ?? previous.display ?? null
        });
      } catch {
        // History is advisory only; ignore malformed lines.
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  return bySession;
}

async function readProjectState(statePath) {
  const state = await readJsonIfPresent(statePath);
  const projects = state?.projects && typeof state.projects === "object"
    ? state.projects
    : {};
  const byLastSessionId = new Map();
  for (const [projectPath, projectState] of Object.entries(projects)) {
    const sessionId = projectState?.lastSessionId;
    if (typeof sessionId === "string" && sessionId) {
      byLastSessionId.set(sessionId, {
        projectPath: normalizePath(projectPath) ?? projectPath,
        lastModelUsage: projectState?.lastModelUsage ?? null,
        lastSessionMetrics: projectState?.lastSessionMetrics ?? null
      });
    }
  }
  return {
    path: statePath,
    projectCount: Object.keys(projects).length,
    byLastSessionId
  };
}

export async function collectCliSessions(options = {}) {
  const claudeHome = path.resolve(options.claudeHome ?? defaultClaudeHome());
  const statePath = path.resolve(options.statePath ?? defaultClaudeStatePath());
  const projectsDir = path.join(claudeHome, "projects");
  const files = await listProjectJsonlFiles(projectsDir);
  const historyBySession = await readHistoryBySession(claudeHome);
  const projectState = await readProjectState(statePath);

  const sessions = [];
  for (const filePath of files) {
    const session = await summarizeJsonlSession(filePath);
    const history = historyBySession.get(session.sessionId);
    const state = projectState.byLastSessionId.get(session.sessionId);
    sessions.push({
      ...session,
      cwd: session.cwd ?? history?.project ?? state?.projectPath ?? null,
      historyDisplay: history?.display ?? null,
      projectState: state ?? null
    });
  }

  sessions.sort((left, right) => (right.lastActivityAtMs ?? 0) - (left.lastActivityAtMs ?? 0));
  return {
    claudeHome,
    statePath,
    projectsDir,
    projectStateSummary: {
      path: projectState.path,
      projectCount: projectState.projectCount
    },
    sessions
  };
}
