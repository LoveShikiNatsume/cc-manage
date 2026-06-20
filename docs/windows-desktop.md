# Windows desktop build

cc-manage can be packaged as an Electron desktop app. The desktop app starts the
existing Fastify backend inside Electron, then opens the React UI in a local
window.

## Data directories

On Windows, cc-manage uses Node's `os.homedir()` default paths:

- Claude Code: `C:\Users\<you>\.claude`
- Codex: `C:\Users\<you>\.codex`

Session, memory, artifact, and usage data are read from the Windows user's own
home directory. They are not bundled into the installer.

## Build commands

Install dependencies:

```powershell
npm install
```

Run the desktop app from a local build:

```powershell
npm run desktop:dev
```

This command temporarily rebuilds `better-sqlite3` for Electron, launches the
desktop app, then restores it for regular Node commands after the app exits.

Create an unpacked app directory for quick testing:

```powershell
npm run desktop:pack
```

Create Windows installer and zip artifacts:

```powershell
npm run desktop:dist:win
```

Artifacts are written to `release/`.

## Tray and Claude Desktop sync

The packaged desktop app stays resident in the Windows tray. Closing the main
window hides it; use the tray menu to open it again or quit the background
process.

When Claude Desktop data directories are present, cc-manage starts the integrated
Claude Desktop session sync in the background. It preserves the standalone sync
behavior: Claude Desktop is not modified while its process is running. If
cc-manage changes Claude JSONL while Claude Desktop is already closed, sync is
requested immediately. If Claude Desktop is running, the request remains pending
and runs after Claude Desktop closes.

Set `CC_MANAGE_CLAUDE_DESKTOP_SYNC=0` to disable the background sync. Set
`CC_MANAGE_CLAUDE_DESKTOP_SYNC_INTERVAL` to change the polling interval in
seconds.

## Notes

- The app starts on port `3456` when available, then tries the next local ports
  if that port is already in use.
- Set `CC_MANAGE_PORT` to choose another starting port.
- The Windows package includes a native `better-sqlite3` dependency for Codex's
  SQLite state. Build the Windows release on Windows, or on a machine configured
  for Electron Windows cross-builds, so electron-builder can rebuild native
  modules correctly.
- The desktop packaging scripts restore `better-sqlite3` back to the regular
  Node ABI after packaging, so `npm test` and the web server keep working in the
  same checkout.
- Node 22.12+ is recommended for packaging because newer Electron packaging
  tools warn on older Node versions.
