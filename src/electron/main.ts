import { app, BrowserWindow, dialog, shell } from 'electron';
import net from 'node:net';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../server/index.js';

const configuredPort = Number.parseInt(process.env.CC_MANAGE_PORT || '3456', 10);
const DEFAULT_PORT = Number.isFinite(configuredPort) ? configuredPort : 3456;

let mainWindow: BrowserWindow | null = null;
let backend: FastifyInstance | null = null;
let backendUrl = '';

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(start: number): Promise<number> {
  for (let port = start; port < start + 50; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available local port found near ${start}`);
}

async function startBackend(): Promise<string> {
  const port = await findAvailablePort(DEFAULT_PORT);
  backend = await createServer({ port, host: '127.0.0.1' });
  backendUrl = `http://127.0.0.1:${port}`;
  return backendUrl;
}

function createWindow(url: string): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    title: 'cc-manage',
    backgroundColor: '#f9fafb',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: 'deny' };
  });

  mainWindow.loadURL(`${url}/sessions`);
}

app.setName('cc-manage');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (!mainWindow && backendUrl) {
    createWindow(backendUrl);
    return;
  }
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.focus();
});

app.whenReady()
  .then(async () => {
    const url = await startBackend();
    createWindow(url);
  })
  .catch(err => {
    dialog.showErrorBox(
      'cc-manage failed to start',
      err instanceof Error ? err.stack ?? err.message : String(err),
    );
    app.quit();
  });

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && backendUrl) {
    createWindow(backendUrl);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async event => {
  if (!backend) return;
  event.preventDefault();
  const server = backend;
  backend = null;
  try {
    await server.close();
  } finally {
    app.exit(0);
  }
});

process.on('uncaughtException', err => {
  dialog.showErrorBox('cc-manage error', err.stack ?? err.message);
});

process.on('unhandledRejection', reason => {
  dialog.showErrorBox('cc-manage error', reason instanceof Error ? reason.stack ?? reason.message : String(reason));
});
