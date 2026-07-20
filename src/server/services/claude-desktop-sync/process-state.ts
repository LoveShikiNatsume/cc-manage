// @ts-nocheck
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parseTasklistCsv(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^"([^"]+)","([^"]+)"/);
      return match ? { imageName: match[1], pid: Number(match[2]) } : null;
    })
    .filter(Boolean);
}

export async function listClaudeDesktopProcesses() {
  try {
    const { stdout } = await execFileAsync("tasklist.exe", ["/FO", "CSV", "/NH"], {
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
    return parseTasklistCsv(stdout)
      .filter((process) => /^claude(?:[- ]?3p)?\.exe$/i.test(process.imageName)
        || /^claude desktop\.exe$/i.test(process.imageName)
        || /^claude[- ]?nest(?:[- ]?3p)?\.exe$/i.test(process.imageName));
  } catch {
    return [];
  }
}

export async function isClaudeDesktopRunning() {
  return (await listClaudeDesktopProcesses()).length > 0;
}
