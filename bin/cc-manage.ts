#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CC_MANAGE_DIR = path.join(os.homedir(), '.cc-manage');
const PID_FILE = path.join(CC_MANAGE_DIR, 'cc-manage.pid');
const LOG_FILE = path.join(CC_MANAGE_DIR, 'cc-manage.log');

// Resolve the server script relative to the CLI script location
const SERVER_SCRIPT = path.resolve(__dirname, '..', 'server', 'index.js');

function ensureDir(): void {
  if (!fs.existsSync(CC_MANAGE_DIR)) {
    fs.mkdirSync(CC_MANAGE_DIR, { recursive: true });
  }
}

function readPid(): number | null {
  try {
    const raw = fs.readFileSync(PID_FILE, 'utf-8').trim();
    const pid = parseInt(raw, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function writePid(pid: number): void {
  fs.writeFileSync(PID_FILE, String(pid), 'utf-8');
}

function removePid(): void {
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv: string[]): { command: string; port: number } {
  const args = argv.slice(2);
  const command = args[0] ?? '';
  let port = 3456;

  const portIdx = args.indexOf('--port');
  if (portIdx !== -1 && args[portIdx + 1]) {
    const parsed = parseInt(args[portIdx + 1], 10);
    if (!isNaN(parsed)) port = parsed;
  }

  return { command, port };
}

function cmdStart(port: number): void {
  ensureDir();

  const existingPid = readPid();
  if (existingPid !== null && isAlive(existingPid)) {
    console.log(`cc-manage is already running (PID ${existingPid})`);
    process.exit(0);
  }

  const logFd = fs.openSync(LOG_FILE, 'a');

  const child = spawn(process.execPath, [SERVER_SCRIPT], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, PORT: String(port) },
  });

  child.unref();
  fs.closeSync(logFd);

  writePid(child.pid!);
  console.log(`cc-manage started (PID ${child.pid}, port ${port})`);
  console.log(`Log: ${LOG_FILE}`);
}

function cmdStop(): void {
  const pid = readPid();
  if (pid === null) {
    console.log('cc-manage is not running (no PID file)');
    process.exit(0);
  }

  if (!isAlive(pid)) {
    console.log(`cc-manage is not running (stale PID ${pid})`);
    removePid();
    process.exit(0);
  }

  try {
    process.kill(pid, 'SIGTERM');
    removePid();
    console.log(`cc-manage stopped (PID ${pid})`);
  } catch (err) {
    console.error(`Failed to stop cc-manage: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

function cmdStatus(): void {
  const pid = readPid();
  if (pid === null) {
    console.log('cc-manage is not running');
    process.exit(0);
  }

  if (isAlive(pid)) {
    console.log(`cc-manage is running (PID ${pid})`);
  } else {
    console.log(`cc-manage is not running (stale PID ${pid})`);
    removePid();
  }
}

function printUsage(): void {
  console.log('Usage: cc-manage <command> [options]');
  console.log('');
  console.log('Commands:');
  console.log('  start [--port <port>]   Start the server (default port: 3456)');
  console.log('  stop                    Stop the server');
  console.log('  status                  Check server status');
}

const { command, port } = parseArgs(process.argv);

switch (command) {
  case 'start':
    cmdStart(port);
    break;
  case 'stop':
    cmdStop();
    break;
  case 'status':
    cmdStatus();
    break;
  default:
    printUsage();
    if (command) process.exit(1);
    break;
}
