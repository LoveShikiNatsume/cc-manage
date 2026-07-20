// @ts-nocheck
import fs from "node:fs/promises";
import path from "node:path";

import { BACKUP_NAMESPACE, defaultBackupRoot } from "./constants.js";
import { copyDirectory, timestampSlug } from "./fs-util.js";

export async function createBackup({ claudeHome, desktopRoots, plannedWrites }) {
  const backupRoot = defaultBackupRoot(claudeHome);
  const backupDir = path.join(backupRoot, timestampSlug());
  await fs.mkdir(backupDir, { recursive: true });

  const roots = [...new Set((Array.isArray(desktopRoots) ? desktopRoots : [desktopRoots]).filter(Boolean))];
  const copied = [];
  for (let i = 0; i < roots.length; i += 1) {
    const desktopRoot = roots[i];
    const desktopSessionsRoot = path.join(desktopRoot, "claude-code-sessions");
    const dirName = roots.length > 1 ? `desktop-${i}` : "desktop";
    if (await copyDirectory(desktopSessionsRoot, path.join(backupDir, dirName, "claude-code-sessions"))) {
      copied.push(desktopSessionsRoot);
    }
  }

  const metadata = {
    version: 1,
    namespace: BACKUP_NAMESPACE,
    createdAt: new Date().toISOString(),
    claudeHome,
    desktopRoots: roots,
    copied,
    plannedWrites
  };
  await fs.writeFile(path.join(backupDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");
  return backupDir;
}

export async function backupSingleMetadataFile({ claudeHome, filePath, reason }) {
  const backupRoot = defaultBackupRoot(claudeHome);
  const backupDir = path.join(backupRoot, "metadata-repairs", timestampSlug());
  await fs.mkdir(backupDir, { recursive: true });
  const target = path.join(backupDir, `${reason}-${path.basename(filePath)}`);
  await fs.copyFile(filePath, target);
  return target;
}

export async function createJsonlBackup({ claudeHome, plannedWrites }) {
  const backupRoot = defaultBackupRoot(claudeHome);
  const backupDir = path.join(backupRoot, timestampSlug());
  const filesDir = path.join(backupDir, "jsonl");
  await fs.mkdir(filesDir, { recursive: true });

  const copied = [];
  const seen = new Set();
  for (const write of plannedWrites ?? []) {
    if (!write.targetPath || seen.has(write.targetPath)) {
      continue;
    }
    seen.add(write.targetPath);
    const backupName = `${path.basename(write.targetPath, ".jsonl")}.jsonl`;
    const backupPath = path.join(filesDir, backupName);
    await fs.copyFile(write.targetPath, backupPath);
    copied.push({ source: write.targetPath, backup: backupPath });
  }

  const metadata = {
    version: 1,
    namespace: BACKUP_NAMESPACE,
    createdAt: new Date().toISOString(),
    claudeHome,
    copied,
    plannedWrites
  };
  await fs.writeFile(path.join(backupDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");
  return backupDir;
}
