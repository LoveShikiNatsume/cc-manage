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
