import fs from "node:fs/promises";
import path from "node:path";

import { defaultBackupRoot, defaultClaudeHome } from "./constants.js";
import { readJsonIfPresent } from "./fs-util.js";
import { withClaudeJsonlWriteLock } from "../claude-jsonl-lock.js";

type SyncStateOptions = {
  claudeHome?: string;
  syncStatePath?: string;
};

type SyncStateData = {
  version: number;
  sessions: Record<string, any>;
  tombstones: Record<string, any>;
};

export function defaultSyncStatePath(claudeHome = defaultClaudeHome()) {
  return path.join(defaultBackupRoot(claudeHome), "sync-state.json");
}

export async function loadSyncState(options: SyncStateOptions = {}) {
  const statePath = options.syncStatePath ?? defaultSyncStatePath(options.claudeHome);
  const state = await readJsonIfPresent(statePath);
  return {
    path: statePath,
    data: state && typeof state === "object"
      ? {
          version: 1,
          sessions: state.sessions && typeof state.sessions === "object" ? state.sessions : {},
          tombstones: state.tombstones && typeof state.tombstones === "object" ? state.tombstones : {}
        }
      : { version: 1, sessions: {}, tombstones: {} }
  };
}

export async function saveSyncState(statePath: string, data: SyncStateData) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const tmpPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, statePath);
}

export async function recordCliSessionDeleted({
  claudeHome,
  syncStatePath,
  sessionId,
  source = "cc-manage",
}: SyncStateOptions & { sessionId: string; source?: string }) {
  return withClaudeJsonlWriteLock(async () => {
    if (typeof sessionId !== "string" || !sessionId) {
      return null;
    }

    const state = await loadSyncState({ claudeHome, syncStatePath });
    state.data.tombstones[sessionId] = {
      deletedSide: "cli",
      source,
      createdAt: new Date().toISOString()
    };
    await saveSyncState(state.path, state.data);
    return state.path;
  });
}
