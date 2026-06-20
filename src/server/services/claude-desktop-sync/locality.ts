// @ts-nocheck
import path from "node:path";

const REMOTE_MARKER_KEYS = new Set([
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
  "wsl_config"
]);

export function isWindowsAbsolutePath(value) {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }
  return /^[a-z]:[\\/]/i.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value);
}

export function hasRemoteSessionMarker(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 3) {
    return false;
  }
  for (const [key, child] of Object.entries(value)) {
    if (REMOTE_MARKER_KEYS.has(key) && child !== null && child !== false) {
      return true;
    }
    if (key === "remoteMcpServersConfig") {
      continue;
    }
    if (key === "is_claude_code_remote" && child === true) {
      return true;
    }
    if (key === "isClaudeCodeRemote" && child === true) {
      return true;
    }
    if (key === "deployment_environment"
        && typeof child === "string"
        && /remote|container|cloud|ssh|wsl/i.test(child)) {
      return true;
    }
    if (hasRemoteSessionMarker(child, depth + 1)) {
      return true;
    }
  }
  return false;
}

export function localWorkspaceReason({ cliSession, sourceDesktopSession } = {}) {
  if (hasRemoteSessionMarker(cliSession?.remoteMarkers)) {
    return "remote marker in JSONL";
  }
  if (hasRemoteSessionMarker(sourceDesktopSession?.raw)) {
    return "remote marker in Desktop metadata";
  }

  const cwd = cliSession?.cwd ?? sourceDesktopSession?.cwd ?? null;
  if (!isWindowsAbsolutePath(cwd)) {
    return `non-Windows cwd: ${cwd ?? "(unknown)"}`;
  }
  return null;
}

export function isLocalWorkspaceSession(input) {
  return localWorkspaceReason(input) === null;
}

export function normalizeComparablePath(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const trimmed = value.trim();
  const normalized = isWindowsAbsolutePath(trimmed)
    ? path.win32.normalize(trimmed)
    : path.resolve(trimmed);
  return normalized.replace(/[\\/]+$/, "").toLowerCase();
}
