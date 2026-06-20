// @ts-nocheck
import os from "node:os";
import path from "node:path";

export const BACKUP_NAMESPACE = "claude-code-desktop-sync";
export const DEFAULT_KEEP_BACKUPS = 5;

export function defaultClaudeHome() {
  return path.join(os.homedir(), ".claude");
}

export function defaultClaudeStatePath() {
  return path.join(os.homedir(), ".claude.json");
}

export function defaultDesktopRoots() {
  return [...defaultApiDesktopRoots(), ...defaultSubscriptionDesktopRoots()];
}

export function defaultApiDesktopRoots() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    return [];
  }
  return [
    path.join(localAppData, "Claude-3p"),
    path.join(localAppData, "Claude Nest-3p")
  ];
}

export function defaultSubscriptionDesktopRoots() {
  const roots = [];
  const appData = process.env.APPDATA;
  const localAppData = process.env.LOCALAPPDATA;
  if (appData) {
    roots.push(path.join(appData, "Claude"));
  }
  if (localAppData) {
    roots.push(path.join(localAppData, "Claude"));
    roots.push(path.join(
      localAppData,
      "Packages",
      "Claude_pzs8sxrjxfjjc",
      "LocalCache",
      "Roaming",
      "Claude"
    ));
  }
  return roots;
}

export function defaultBackupRoot(claudeHome = defaultClaudeHome()) {
  return path.join(claudeHome, "backups_state", BACKUP_NAMESPACE);
}
