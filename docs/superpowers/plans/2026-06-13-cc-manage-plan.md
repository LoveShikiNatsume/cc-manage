# cc-manage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local web tool for unified management of Claude Code and Codex conversation history, memory files, and usage monitoring.

**Architecture:** Single-process Node.js server — Fastify backend serves REST API + pre-built React SPA static files. Data layer reads JSONL files, Markdown files, and SQLite directly from disk. No persistent database of its own.

**Tech Stack:** TypeScript, Node.js 20, Fastify 5, React 19, Tailwind CSS v4, Vite 6, tsup, vitest, better-sqlite3, gray-matter

---

## File Structure

```
cc-manage/
├── package.json
├── tsconfig.json
├── tsconfig.server.json
├── vite.config.ts
├── tsup.config.ts
├── vitest.config.ts
├── bin/
│   └── cc-manage.ts
├── src/
│   ├── shared/
│   │   └── types.ts
│   ├── server/
│   │   ├── index.ts
│   │   ├── routes/
│   │   │   ├── sessions.ts
│   │   │   ├── memory.ts
│   │   │   └── usage.ts
│   │   ├── providers/
│   │   │   ├── claude.ts
│   │   │   └── codex.ts
│   │   └── services/
│   │       ├── session-parser.ts
│   │       ├── memory-manager.ts
│   │       ├── codex-memory.ts
│   │       └── usage-fetcher.ts
│   └── client/
│       ├── index.html
│       ├── index.css
│       ├── main.tsx
│       ├── App.tsx
│       ├── lib/
│       │   └── api.ts
│       ├── hooks/
│       │   └── useVisibilityPolling.ts
│       ├── components/
│       │   └── Layout.tsx
│       └── pages/
│           ├── Sessions.tsx
│           ├── Memory.tsx
│           └── Usage.tsx
├── tests/
│   ├── fixtures/
│   │   ├── claude-session.jsonl
│   │   └── codex-session.jsonl
│   ├── session-parser.test.ts
│   ├── claude-provider.test.ts
│   ├── codex-provider.test.ts
│   ├── memory-manager.test.ts
│   ├── codex-memory.test.ts
│   ├── usage-fetcher.test.ts
│   └── routes/
│       ├── sessions.test.ts
│       ├── memory.test.ts
│       └── usage.test.ts
└── dist/
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.server.json`
- Create: `vite.config.ts`
- Create: `tsup.config.ts`
- Create: `vitest.config.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "cc-manage",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "cc-manage": "./dist/bin/cc-manage.js"
  },
  "files": ["dist/"],
  "scripts": {
    "dev": "concurrently \"vite\" \"tsx watch src/server/index.ts\"",
    "dev:server": "tsx watch src/server/index.ts",
    "dev:client": "vite",
    "build": "npm run build:client && npm run build:server",
    "build:client": "vite build",
    "build:server": "tsup",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "fastify": "^5.0.0",
    "@fastify/static": "^8.0.0",
    "@fastify/cors": "^10.0.0",
    "better-sqlite3": "^11.0.0",
    "gray-matter": "^4.0.3"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/node": "^22.0.0",
    "@types/better-sqlite3": "^7.6.0",
    "tsup": "^8.0.0",
    "tsx": "^4.0.0",
    "concurrently": "^9.0.0",
    "vite": "^6.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "vitest": "^3.0.0",
    "lucide-react": "^0.460.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json (frontend)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "paths": {
      "@shared/*": ["./src/shared/*"]
    }
  },
  "include": ["src/client", "src/shared"]
}
```

- [ ] **Step 3: Create tsconfig.server.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": ".",
    "paths": {
      "@shared/*": ["./src/shared/*"]
    }
  },
  "include": ["src/server", "src/shared", "bin"]
}
```

- [ ] **Step 4: Create vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: 'src/client',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3456',
    },
  },
});
```

- [ ] **Step 5: Create tsup.config.ts**

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'server/index': 'src/server/index.ts',
    'bin/cc-manage': 'bin/cc-manage.ts',
  },
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: false,
  splitting: false,
  sourcemap: true,
  external: ['better-sqlite3'],
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
});
```

- [ ] **Step 6: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    root: '.',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
});
```

- [ ] **Step 7: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` generated, no errors.

- [ ] **Step 8: Create directory structure**

```bash
mkdir -p src/shared src/server/routes src/server/providers src/server/services
mkdir -p src/client/lib src/client/hooks src/client/components src/client/pages
mkdir -p bin tests/fixtures tests/routes
```

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.server.json vite.config.ts tsup.config.ts vitest.config.ts
git commit -m "chore: scaffold project with configs and dependencies"
```

---

### Task 2: Shared Types

**Files:**
- Create: `src/shared/types.ts`

- [ ] **Step 1: Create type definitions**

```typescript
// src/shared/types.ts

export type Provider = 'claude' | 'codex';

export interface SessionMeta {
  id: string;
  provider: Provider;
  title: string;
  project: string;
  cwd: string;
  lastActivity: number;
  filePath: string;
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
}

export interface ProjectGroup {
  name: string;
  cwd: string;
  sessions: SessionMeta[];
}

export interface ProviderGroup {
  provider: Provider;
  projects: ProjectGroup[];
}

export interface MemoryFileMeta {
  filename: string;
  name: string;
  description: string;
  type: string;
}

export interface MemoryFileContent extends MemoryFileMeta {
  body: string;
  rawContent: string;
}

export interface MemoryProject {
  project: string;
  projectDir: string;
  memories: MemoryFileMeta[];
}

export interface CodexMemoryEntry {
  threadId: string;
  rawMemory: string;
  rolloutSummary: string;
  rolloutSlug: string | null;
  generatedAt: number;
}

export interface UsageTier {
  name: string;
  label: string;
  utilization: number;
  resetAt: number;
}

export interface ProviderUsage {
  provider: Provider;
  tiers: UsageTier[];
  error?: string;
  tokenExpired?: boolean;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add shared type definitions"
```

---

### Task 3: Session Parser

**Files:**
- Create: `tests/fixtures/claude-session.jsonl`
- Create: `tests/fixtures/codex-session.jsonl`
- Create: `tests/session-parser.test.ts`
- Create: `src/server/services/session-parser.ts`

- [ ] **Step 1: Create Claude test fixture**

```jsonl
{"type":"queue-operation","operation":"enqueue","timestamp":"2026-06-01T02:40:05.900Z","sessionId":"54e98281-0ab1-465a-9293-8cf7055c5c1f"}
{"type":"queue-operation","operation":"dequeue","timestamp":"2026-06-01T02:40:05.915Z","sessionId":"54e98281-0ab1-465a-9293-8cf7055c5c1f"}
{"parentUuid":null,"isSidechain":false,"type":"user","message":{"role":"user","content":[{"type":"text","text":"Help me refactor the auth module"}]},"cwd":"/home/user/myproject","timestamp":"2026-06-01T02:40:06.000Z","sessionId":"54e98281-0ab1-465a-9293-8cf7055c5c1f"}
{"parentUuid":"abc","isSidechain":false,"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"I'll help you refactor the auth module."}]},"timestamp":"2026-06-01T02:41:00.000Z"}
{"parentUuid":"def","isSidechain":false,"type":"user","message":{"role":"user","content":[{"type":"text","text":"Looks good, please continue"}]},"timestamp":"2026-06-01T02:42:00.000Z"}
{"parentUuid":"ghi","isSidechain":false,"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Done with the refactoring."}]},"timestamp":"2026-06-01T02:43:00.000Z"}
```

- [ ] **Step 2: Create Codex test fixture**

```jsonl
{"timestamp":"2026-06-04T05:38:46.641Z","type":"session_meta","payload":{"id":"019e9124-2875-72f2-bda8-2060565c8e68","timestamp":"2026-06-04T05:38:46.517Z","cwd":"/home/user/project","source":"vscode","cli_version":"0.133.0"}}
{"timestamp":"2026-06-04T05:38:46.652Z","type":"event_msg","payload":{"type":"task_started"}}
{"timestamp":"2026-06-04T05:39:01.618Z","type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"<permissions instructions>sandbox stuff</permissions instructions>"}]}}
{"timestamp":"2026-06-04T05:39:01.618Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"# AGENTS.md instructions for /home/user/project\n\nKeep it clean."}]}}
{"timestamp":"2026-06-04T05:39:01.619Z","type":"turn_context","payload":{"turn_id":"abc","cwd":"/home/user/project","model":"gpt-5.5"}}
{"timestamp":"2026-06-04T05:39:02.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Fix the login bug on the settings page"}]}}
{"timestamp":"2026-06-04T05:39:10.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"I'll fix the login bug now."}]}}
{"timestamp":"2026-06-04T05:40:00.000Z","type":"event_msg","payload":{"type":"task_completed"}}
```

- [ ] **Step 3: Write failing tests for session parser**

```typescript
// tests/session-parser.test.ts
import { describe, it, expect } from 'vitest';
import path from 'path';
import {
  readHeadTail,
  extractClaudeSessionMeta,
  extractCodexSessionMeta,
  parseClaudeMessages,
  parseCodexMessages,
} from '../src/server/services/session-parser.js';

const FIXTURES = path.resolve(__dirname, 'fixtures');

describe('readHeadTail', () => {
  it('reads all lines from small files', async () => {
    const result = await readHeadTail(path.join(FIXTURES, 'claude-session.jsonl'));
    expect(result.headLines.length).toBeGreaterThan(0);
    expect(result.tailLines.length).toBeGreaterThan(0);
  });
});

describe('extractClaudeSessionMeta', () => {
  it('extracts session ID from queue-operation lines', () => {
    const headLines = [
      '{"type":"queue-operation","operation":"enqueue","timestamp":"2026-06-01T02:40:05.900Z","sessionId":"abc-123"}',
      '{"type":"queue-operation","operation":"dequeue","timestamp":"2026-06-01T02:40:05.915Z","sessionId":"abc-123"}',
      '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Hello world"}]},"cwd":"/home/user/proj","timestamp":"2026-06-01T02:40:06.000Z","sessionId":"abc-123"}',
    ];
    const meta = extractClaudeSessionMeta(headLines, [], '/path/to/file.jsonl');
    expect(meta.id).toBe('abc-123');
    expect(meta.title).toBe('Hello world');
    expect(meta.cwd).toBe('/home/user/proj');
  });

  it('prefers custom-title over first user message', () => {
    const headLines = [
      '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Original title"}]},"cwd":"/home/user/proj","timestamp":"2026-06-01T02:40:06.000Z","sessionId":"abc-123"}',
    ];
    const tailLines = [
      '{"type":"custom-title","title":"My Custom Title","timestamp":"2026-06-01T03:00:00.000Z"}',
    ];
    const meta = extractClaudeSessionMeta(headLines, tailLines, '/path/to/file.jsonl');
    expect(meta.title).toBe('My Custom Title');
  });

  it('extracts lastActivity from tail timestamps', () => {
    const headLines = [
      '{"type":"user","message":{"role":"user","content":"hi"},"cwd":"/proj","timestamp":"2026-06-01T02:40:00.000Z","sessionId":"abc"}',
    ];
    const tailLines = [
      '{"type":"assistant","message":{"role":"assistant","content":"bye"},"timestamp":"2026-06-01T03:00:00.000Z"}',
    ];
    const meta = extractClaudeSessionMeta(headLines, tailLines, '/path/file.jsonl');
    expect(meta.lastActivity).toBe(new Date('2026-06-01T03:00:00.000Z').getTime());
  });
});

describe('extractCodexSessionMeta', () => {
  it('extracts session ID and cwd from session_meta', () => {
    const headLines = [
      '{"timestamp":"2026-06-04T05:38:46.641Z","type":"session_meta","payload":{"id":"019e-uuid","cwd":"/home/user/project"}}',
      '{"timestamp":"2026-06-04T05:38:46.652Z","type":"event_msg","payload":{"type":"task_started"}}',
      '{"timestamp":"2026-06-04T05:39:01.618Z","type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"<permissions>stuff</permissions>"}]}}',
      '{"timestamp":"2026-06-04T05:39:01.618Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"# AGENTS.md instructions\\nstuff"}]}}',
      '{"timestamp":"2026-06-04T05:39:02.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Fix the login bug"}]}}',
    ];
    const meta = extractCodexSessionMeta(headLines, [], '/path/file.jsonl');
    expect(meta.id).toBe('019e-uuid');
    expect(meta.cwd).toBe('/home/user/project');
    expect(meta.title).toBe('Fix the login bug');
  });

  it('filters out AGENTS.md and permission messages for title', () => {
    const headLines = [
      '{"timestamp":"2026-06-04T05:38:46.641Z","type":"session_meta","payload":{"id":"019e","cwd":"/proj"}}',
      '{"timestamp":"2026-06-04T05:39:01.618Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"# AGENTS.md instructions for /proj\\nKeep clean."}]}}',
      '{"timestamp":"2026-06-04T05:39:02.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Implement dark mode"}]}}',
    ];
    const meta = extractCodexSessionMeta(headLines, [], '/path/file.jsonl');
    expect(meta.title).toBe('Implement dark mode');
  });

  it('extracts prompt from VS Code IDE context', () => {
    const headLines = [
      '{"timestamp":"2026-06-04T05:38:46.641Z","type":"session_meta","payload":{"id":"019e","cwd":"/proj"}}',
      '{"timestamp":"2026-06-04T05:39:02.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Some IDE context here\\n## My request for Codex:\\nPlease fix the tests"}]}}',
    ];
    const meta = extractCodexSessionMeta(headLines, [], '/path/file.jsonl');
    expect(meta.title).toBe('Please fix the tests');
  });
});

describe('parseClaudeMessages', () => {
  it('parses all user and assistant messages from JSONL', async () => {
    const filePath = path.join(FIXTURES, 'claude-session.jsonl');
    const messages = await parseClaudeMessages(filePath);
    expect(messages.length).toBe(4);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('Help me refactor the auth module');
    expect(messages[1].role).toBe('assistant');
    expect(messages[3].role).toBe('assistant');
  });
});

describe('parseCodexMessages', () => {
  it('parses user and assistant messages, skipping system entries', async () => {
    const filePath = path.join(FIXTURES, 'codex-session.jsonl');
    const messages = await parseCodexMessages(filePath);
    const roles = messages.map(m => m.role);
    expect(roles).not.toContain('system');
    expect(messages.some(m => m.role === 'user' && m.content.includes('Fix the login bug'))).toBe(true);
    expect(messages.some(m => m.role === 'assistant')).toBe(true);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/session-parser.test.ts`
Expected: FAIL — module `../src/server/services/session-parser.js` not found.

- [ ] **Step 5: Implement session parser**

```typescript
// src/server/services/session-parser.ts
import fs from 'fs/promises';
import type { SessionMeta, SessionMessage } from '@shared/types.js';

const HEAD_LINES = 10;
const TAIL_LINES = 30;
const SMALL_FILE_THRESHOLD = 16 * 1024;
const TAIL_BUFFER_SIZE = 16 * 1024;
const TITLE_MAX_CHARS = 80;

export interface HeadTailResult {
  headLines: string[];
  tailLines: string[];
}

export async function readHeadTail(filePath: string): Promise<HeadTailResult> {
  const stat = await fs.stat(filePath);

  if (stat.size <= SMALL_FILE_THRESHOLD) {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    return {
      headLines: lines.slice(0, HEAD_LINES),
      tailLines: lines.slice(-TAIL_LINES),
    };
  }

  const fd = await fs.open(filePath, 'r');
  try {
    const headBuf = Buffer.alloc(TAIL_BUFFER_SIZE);
    const { bytesRead: headBytes } = await fd.read(headBuf, 0, TAIL_BUFFER_SIZE, 0);
    const headLines = headBuf
      .subarray(0, headBytes)
      .toString('utf-8')
      .split('\n')
      .filter(l => l.trim())
      .slice(0, HEAD_LINES);

    const tailOffset = Math.max(0, stat.size - TAIL_BUFFER_SIZE);
    const tailBuf = Buffer.alloc(Math.min(TAIL_BUFFER_SIZE, stat.size));
    const { bytesRead: tailBytes } = await fd.read(tailBuf, 0, tailBuf.length, tailOffset);
    const allTailLines = tailBuf
      .subarray(0, tailBytes)
      .toString('utf-8')
      .split('\n')
      .filter(l => l.trim());
    const tailLines =
      tailOffset > 0
        ? allTailLines.slice(1).slice(-TAIL_LINES)
        : allTailLines.slice(-TAIL_LINES);

    return { headLines, tailLines };
  } finally {
    await fd.close();
  }
}

function safeParseJSON(line: string): any | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function extractTextContent(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if ((block.type === 'text' || block.type === 'input_text' || block.type === 'output_text') && block.text) {
        return block.text;
      }
    }
  }
  return null;
}

function extractTimestamp(obj: any): number | null {
  const ts = obj.timestamp ?? obj.message?.timestamp;
  if (!ts) return null;
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') return new Date(ts).getTime();
  return null;
}

// --- Claude ---

export function extractClaudeSessionMeta(
  headLines: string[],
  tailLines: string[],
  filePath: string,
): SessionMeta {
  let id = '';
  let title = '';
  let cwd = '';
  let lastActivity = 0;

  for (const line of headLines) {
    const obj = safeParseJSON(line);
    if (!obj) continue;

    if (obj.type === 'queue-operation' && obj.sessionId && !id) {
      id = obj.sessionId;
    }

    if (obj.type === 'user' && obj.message?.content && !title) {
      const text = extractTextContent(obj.message.content);
      if (text) title = text.slice(0, TITLE_MAX_CHARS);
    }

    if (obj.cwd && !cwd) cwd = obj.cwd;

    const ts = extractTimestamp(obj);
    if (ts && ts > lastActivity) lastActivity = ts;
  }

  for (let i = tailLines.length - 1; i >= 0; i--) {
    const obj = safeParseJSON(tailLines[i]);
    if (!obj) continue;

    if (obj.type === 'custom-title' && obj.title) {
      title = obj.title.slice(0, TITLE_MAX_CHARS);
    }

    const ts = extractTimestamp(obj);
    if (ts && ts > lastActivity) lastActivity = ts;
  }

  const project = cwd ? cwd.split('/').pop() || cwd : 'unknown';

  return {
    id: id || filePath.split('/').pop()?.replace('.jsonl', '') || 'unknown',
    provider: 'claude',
    title: title || 'Untitled',
    project,
    cwd,
    lastActivity,
    filePath,
  };
}

export async function parseClaudeMessages(filePath: string): Promise<SessionMessage[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  const messages: SessionMessage[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    const obj = safeParseJSON(line);
    if (!obj) continue;

    if ((obj.type === 'user' || obj.type === 'assistant') && obj.message?.content) {
      const text = extractTextContent(obj.message.content);
      if (text) {
        messages.push({
          role: obj.message.role || obj.type,
          content: text,
          timestamp: extractTimestamp(obj) || 0,
        });
      }
    }
  }

  return messages;
}

// --- Codex ---

function isCodexSystemContent(text: string): boolean {
  return (
    text.startsWith('# AGENTS.md') ||
    text.startsWith('<permissions') ||
    text.startsWith('<environment_context')
  );
}

function extractCodexUserPrompt(text: string): string | null {
  if (isCodexSystemContent(text)) return null;

  const marker = '## My request for Codex:';
  const idx = text.indexOf(marker);
  if (idx !== -1) {
    return text.slice(idx + marker.length).trim();
  }

  return text.trim();
}

export function extractCodexSessionMeta(
  headLines: string[],
  tailLines: string[],
  filePath: string,
): SessionMeta {
  let id = '';
  let cwd = '';
  let title = '';
  let lastActivity = 0;

  for (const line of headLines) {
    const obj = safeParseJSON(line);
    if (!obj) continue;

    if (obj.type === 'session_meta' && obj.payload) {
      if (obj.payload.id && !id) id = obj.payload.id;
      if (obj.payload.cwd && !cwd) cwd = obj.payload.cwd;
    }

    if (
      obj.type === 'response_item' &&
      obj.payload?.role === 'user' &&
      obj.payload?.content &&
      !title
    ) {
      const text = extractTextContent(obj.payload.content);
      if (text) {
        const prompt = extractCodexUserPrompt(text);
        if (prompt) title = prompt.slice(0, TITLE_MAX_CHARS);
      }
    }

    const ts = obj.timestamp ? new Date(obj.timestamp).getTime() : null;
    if (ts && ts > lastActivity) lastActivity = ts;
  }

  for (let i = tailLines.length - 1; i >= 0; i--) {
    const obj = safeParseJSON(tailLines[i]);
    if (!obj) continue;
    const ts = obj.timestamp ? new Date(obj.timestamp).getTime() : null;
    if (ts && ts > lastActivity) lastActivity = ts;
  }

  const project = cwd ? cwd.split('/').pop() || cwd : 'unknown';

  return {
    id: id || filePath.split('/').pop()?.replace('.jsonl', '') || 'unknown',
    provider: 'codex',
    title: title || 'Untitled',
    project,
    cwd,
    lastActivity,
    filePath,
  };
}

export async function parseCodexMessages(filePath: string): Promise<SessionMessage[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  const messages: SessionMessage[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    const obj = safeParseJSON(line);
    if (!obj || obj.type !== 'response_item' || !obj.payload) continue;

    const role = obj.payload.role;
    if (role === 'developer') continue;

    const text = extractTextContent(obj.payload.content);
    if (!text) continue;

    if (role === 'user' && isCodexSystemContent(text)) continue;

    let cleanText = text;
    if (role === 'user') {
      const prompt = extractCodexUserPrompt(text);
      if (!prompt) continue;
      cleanText = prompt;
    }

    messages.push({
      role: role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : 'system',
      content: cleanText,
      timestamp: obj.timestamp ? new Date(obj.timestamp).getTime() : 0,
    });
  }

  return messages;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/session-parser.test.ts`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures/ tests/session-parser.test.ts src/server/services/session-parser.ts
git commit -m "feat: implement JSONL session parser with head+tail strategy"
```

---

### Task 4: Claude Session Provider

**Files:**
- Create: `tests/claude-provider.test.ts`
- Create: `src/server/providers/claude.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/claude-provider.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  discoverClaudeSessions,
  deleteClaudeSession,
  renameClaudeSession,
  getClaudeConfigDir,
} from '../src/server/providers/claude.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-manage-test-'));
  const projectDir = path.join(tmpDir, 'projects', '-home-user-myproject');
  await fs.mkdir(projectDir, { recursive: true });

  const sessionContent = [
    '{"type":"queue-operation","operation":"enqueue","timestamp":"2026-06-01T02:40:05.900Z","sessionId":"sess-001"}',
    '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Build a dashboard"}]},"cwd":"/home/user/myproject","timestamp":"2026-06-01T02:40:06.000Z","sessionId":"sess-001"}',
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Sure!"}]},"timestamp":"2026-06-01T02:41:00.000Z"}',
  ].join('\n');

  await fs.writeFile(path.join(projectDir, 'sess-001.jsonl'), sessionContent);
  // Agent-prefixed files should be skipped
  await fs.writeFile(path.join(projectDir, 'agent-sub1.jsonl'), sessionContent);
  // Sidecar directory for sess-001
  await fs.mkdir(path.join(projectDir, 'sess-001'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('discoverClaudeSessions', () => {
  it('finds JSONL sessions and skips agent- prefixed files', async () => {
    const sessions = await discoverClaudeSessions(tmpDir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('sess-001');
    expect(sessions[0].title).toBe('Build a dashboard');
    expect(sessions[0].provider).toBe('claude');
  });
});

describe('deleteClaudeSession', () => {
  it('deletes JSONL file and sidecar directory', async () => {
    const sessions = await discoverClaudeSessions(tmpDir);
    await deleteClaudeSession(sessions[0].filePath);
    const remaining = await discoverClaudeSessions(tmpDir);
    expect(remaining).toHaveLength(0);
  });
});

describe('renameClaudeSession', () => {
  it('appends custom-title entry to JSONL', async () => {
    const sessions = await discoverClaudeSessions(tmpDir);
    await renameClaudeSession(sessions[0].filePath, 'New Title');
    const updated = await discoverClaudeSessions(tmpDir);
    expect(updated[0].title).toBe('New Title');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/claude-provider.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement Claude provider**

```typescript
// src/server/providers/claude.ts
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { SessionMeta, SessionMessage } from '@shared/types.js';
import {
  readHeadTail,
  extractClaudeSessionMeta,
  parseClaudeMessages,
} from '../services/session-parser.js';

export function getClaudeConfigDir(): string {
  return path.join(os.homedir(), '.claude');
}

export async function discoverClaudeSessions(
  configDir?: string,
): Promise<SessionMeta[]> {
  const baseDir = configDir || getClaudeConfigDir();
  const projectsDir = path.join(baseDir, 'projects');

  try {
    await fs.access(projectsDir);
  } catch {
    return [];
  }

  const sessions: SessionMeta[] = [];
  const projects = await fs.readdir(projectsDir);

  for (const project of projects) {
    const projectPath = path.join(projectsDir, project);
    const stat = await fs.stat(projectPath);
    if (!stat.isDirectory()) continue;

    const files = await fs.readdir(projectPath);
    for (const file of files) {
      if (!file.endsWith('.jsonl') || file.startsWith('agent-')) continue;
      const filePath = path.join(projectPath, file);
      try {
        const { headLines, tailLines } = await readHeadTail(filePath);
        const meta = extractClaudeSessionMeta(headLines, tailLines, filePath);
        sessions.push(meta);
      } catch {
        // Skip unreadable files
      }
    }
  }

  return sessions.sort((a, b) => b.lastActivity - a.lastActivity);
}

export async function getClaudeMessages(filePath: string): Promise<SessionMessage[]> {
  await validatePath(filePath);
  return parseClaudeMessages(filePath);
}

export async function deleteClaudeSession(filePath: string): Promise<void> {
  await validatePath(filePath);
  await fs.rm(filePath, { force: true });

  // Remove sidecar directory (same name without .jsonl extension)
  const sidecarDir = filePath.replace(/\.jsonl$/, '');
  try {
    const stat = await fs.stat(sidecarDir);
    if (stat.isDirectory()) {
      await fs.rm(sidecarDir, { recursive: true, force: true });
    }
  } catch {
    // No sidecar directory
  }
}

export async function renameClaudeSession(
  filePath: string,
  title: string,
): Promise<void> {
  await validatePath(filePath);
  const entry = JSON.stringify({
    type: 'custom-title',
    title,
    timestamp: new Date().toISOString(),
  });
  await fs.appendFile(filePath, '\n' + entry);
}

async function validatePath(filePath: string): Promise<void> {
  const resolved = path.resolve(filePath);
  const claudeDir = path.resolve(getClaudeConfigDir());
  if (!resolved.startsWith(claudeDir)) {
    throw new Error('Path traversal detected');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/claude-provider.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/claude-provider.test.ts src/server/providers/claude.ts
git commit -m "feat: implement Claude session provider with discover/delete/rename"
```

---

### Task 5: Codex Session Provider

**Files:**
- Create: `tests/codex-provider.test.ts`
- Create: `src/server/providers/codex.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/codex-provider.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { discoverCodexSessions, deleteCodexSession } from '../src/server/providers/codex.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-manage-codex-test-'));
  const sessionDir = path.join(tmpDir, 'sessions', '2026', '06', '04');
  await fs.mkdir(sessionDir, { recursive: true });

  const sessionContent = [
    '{"timestamp":"2026-06-04T05:38:46.641Z","type":"session_meta","payload":{"id":"019e-uuid","cwd":"/home/user/project","source":"cli"}}',
    '{"timestamp":"2026-06-04T05:39:02.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Implement search feature"}]}}',
    '{"timestamp":"2026-06-04T05:40:00.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Done."}]}}',
  ].join('\n');

  await fs.writeFile(
    path.join(sessionDir, 'rollout-2026-06-04T05-38-46-019e-uuid.jsonl'),
    sessionContent,
  );

  // Subagent session should be skipped
  const subagentContent = [
    '{"timestamp":"2026-06-04T05:38:46.641Z","type":"session_meta","payload":{"id":"sub-001","cwd":"/proj","source":{"subagent":true}}}',
  ].join('\n');
  await fs.writeFile(
    path.join(sessionDir, 'rollout-2026-06-04T06-00-00-sub-001.jsonl'),
    subagentContent,
  );
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('discoverCodexSessions', () => {
  it('finds Codex sessions and skips subagent sessions', async () => {
    const sessions = await discoverCodexSessions(tmpDir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('019e-uuid');
    expect(sessions[0].title).toBe('Implement search feature');
    expect(sessions[0].provider).toBe('codex');
  });
});

describe('deleteCodexSession', () => {
  it('deletes the JSONL file', async () => {
    const sessions = await discoverCodexSessions(tmpDir);
    await deleteCodexSession(sessions[0].filePath);
    const remaining = await discoverCodexSessions(tmpDir);
    expect(remaining).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/codex-provider.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement Codex provider**

```typescript
// src/server/providers/codex.ts
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { SessionMeta, SessionMessage } from '@shared/types.js';
import {
  readHeadTail,
  extractCodexSessionMeta,
  parseCodexMessages,
} from '../services/session-parser.js';

export function getCodexConfigDir(): string {
  return path.join(os.homedir(), '.codex');
}

async function collectJsonlFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(current: string) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  }

  await walk(dir);
  return files;
}

function isSubagentSession(headLines: string[]): boolean {
  for (const line of headLines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'session_meta') {
        const source = obj.payload?.source;
        if (typeof source === 'object' && source?.subagent) return true;
      }
    } catch {}
  }
  return false;
}

export async function discoverCodexSessions(
  configDir?: string,
): Promise<SessionMeta[]> {
  const baseDir = configDir || getCodexConfigDir();
  const sessions: SessionMeta[] = [];
  const searchDirs = [
    path.join(baseDir, 'sessions'),
    path.join(baseDir, 'archived_sessions'),
  ];

  for (const dir of searchDirs) {
    const files = await collectJsonlFiles(dir);
    for (const filePath of files) {
      try {
        const { headLines, tailLines } = await readHeadTail(filePath);
        if (isSubagentSession(headLines)) continue;
        const meta = extractCodexSessionMeta(headLines, tailLines, filePath);
        sessions.push(meta);
      } catch {
        // Skip unreadable files
      }
    }
  }

  return sessions.sort((a, b) => b.lastActivity - a.lastActivity);
}

export async function getCodexMessages(filePath: string): Promise<SessionMessage[]> {
  await validatePath(filePath);
  return parseCodexMessages(filePath);
}

export async function deleteCodexSession(filePath: string): Promise<void> {
  await validatePath(filePath);
  await fs.rm(filePath, { force: true });
}

async function validatePath(filePath: string): Promise<void> {
  const resolved = path.resolve(filePath);
  const codexDir = path.resolve(getCodexConfigDir());
  if (!resolved.startsWith(codexDir)) {
    throw new Error('Path traversal detected');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/codex-provider.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/codex-provider.test.ts src/server/providers/codex.ts
git commit -m "feat: implement Codex session provider with discover/delete"
```

---

### Task 6: Claude Memory Manager

**Files:**
- Create: `tests/memory-manager.test.ts`
- Create: `src/server/services/memory-manager.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/memory-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  listMemoryProjects,
  listMemories,
  readMemory,
  createMemory,
  updateMemory,
  deleteMemory,
} from '../src/server/services/memory-manager.js';

let tmpDir: string;
let projectMemoryDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-manage-mem-'));
  projectMemoryDir = path.join(tmpDir, 'projects', '-home-user-myproject', 'memory');
  await fs.mkdir(projectMemoryDir, { recursive: true });

  await fs.writeFile(
    path.join(projectMemoryDir, 'user-role.md'),
    `---
name: user-role
description: User is a backend engineer
metadata:
  type: user
---

User prefers Go and Python.`,
  );

  await fs.writeFile(
    path.join(projectMemoryDir, 'MEMORY.md'),
    '- [User Role](user-role.md) — User is a backend engineer\n',
  );
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('listMemoryProjects', () => {
  it('lists projects that have memory directories', async () => {
    const projects = await listMemoryProjects(tmpDir);
    expect(projects).toHaveLength(1);
    expect(projects[0].project).toBe('-home-user-myproject');
    expect(projects[0].memories).toHaveLength(1);
    expect(projects[0].memories[0].name).toBe('user-role');
  });
});

describe('readMemory', () => {
  it('reads memory file with frontmatter and body', async () => {
    const mem = await readMemory(
      path.join(projectMemoryDir, 'user-role.md'),
      tmpDir,
    );
    expect(mem.name).toBe('user-role');
    expect(mem.description).toBe('User is a backend engineer');
    expect(mem.body).toContain('User prefers Go and Python.');
  });
});

describe('createMemory', () => {
  it('creates a new memory file and updates MEMORY.md', async () => {
    await createMemory(
      projectMemoryDir,
      'feedback-testing',
      {
        name: 'feedback-testing',
        description: 'Always run tests before committing',
        type: 'feedback',
      },
      'Run tests first.\n\n**Why:** Prevents regressions.',
      tmpDir,
    );
    const content = await fs.readFile(
      path.join(projectMemoryDir, 'feedback-testing.md'),
      'utf-8',
    );
    expect(content).toContain('feedback-testing');
    const index = await fs.readFile(
      path.join(projectMemoryDir, 'MEMORY.md'),
      'utf-8',
    );
    expect(index).toContain('feedback-testing.md');
  });
});

describe('deleteMemory', () => {
  it('deletes memory file and removes entry from MEMORY.md', async () => {
    await deleteMemory(
      path.join(projectMemoryDir, 'user-role.md'),
      projectMemoryDir,
      tmpDir,
    );
    const files = await fs.readdir(projectMemoryDir);
    expect(files).not.toContain('user-role.md');
    const index = await fs.readFile(
      path.join(projectMemoryDir, 'MEMORY.md'),
      'utf-8',
    );
    expect(index).not.toContain('user-role.md');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/memory-manager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement memory manager**

```typescript
// src/server/services/memory-manager.ts
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import matter from 'gray-matter';
import type { MemoryFileMeta, MemoryFileContent, MemoryProject } from '@shared/types.js';

function getDefaultClaudeDir(): string {
  return path.join(os.homedir(), '.claude');
}

async function validatePath(filePath: string, configDir?: string): Promise<void> {
  const resolved = path.resolve(filePath);
  const baseDir = path.resolve(configDir || getDefaultClaudeDir());
  if (!resolved.startsWith(baseDir)) {
    throw new Error('Path traversal detected');
  }
}

export async function listMemoryProjects(
  configDir?: string,
): Promise<MemoryProject[]> {
  const baseDir = configDir || getDefaultClaudeDir();
  const projectsDir = path.join(baseDir, 'projects');
  const result: MemoryProject[] = [];

  let projects: string[];
  try {
    projects = await fs.readdir(projectsDir);
  } catch {
    return [];
  }

  for (const project of projects) {
    const memoryDir = path.join(projectsDir, project, 'memory');
    try {
      const stat = await fs.stat(memoryDir);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }

    const files = await fs.readdir(memoryDir);
    const memories: MemoryFileMeta[] = [];

    for (const file of files) {
      if (!file.endsWith('.md') || file === 'MEMORY.md') continue;
      try {
        const content = await fs.readFile(path.join(memoryDir, file), 'utf-8');
        const { data } = matter(content);
        memories.push({
          filename: file,
          name: data.name || file.replace('.md', ''),
          description: data.description || '',
          type: data.metadata?.type || 'unknown',
        });
      } catch {
        // Skip unreadable files
      }
    }

    if (memories.length > 0) {
      result.push({
        project,
        projectDir: memoryDir,
        memories,
      });
    }
  }

  return result;
}

export async function listMemories(
  memoryDir: string,
  configDir?: string,
): Promise<MemoryFileMeta[]> {
  await validatePath(memoryDir, configDir);
  const files = await fs.readdir(memoryDir);
  const memories: MemoryFileMeta[] = [];

  for (const file of files) {
    if (!file.endsWith('.md') || file === 'MEMORY.md') continue;
    const content = await fs.readFile(path.join(memoryDir, file), 'utf-8');
    const { data } = matter(content);
    memories.push({
      filename: file,
      name: data.name || file.replace('.md', ''),
      description: data.description || '',
      type: data.metadata?.type || 'unknown',
    });
  }

  return memories;
}

export async function readMemory(
  filePath: string,
  configDir?: string,
): Promise<MemoryFileContent> {
  await validatePath(filePath, configDir);
  const raw = await fs.readFile(filePath, 'utf-8');
  const { data, content } = matter(raw);

  return {
    filename: path.basename(filePath),
    name: data.name || path.basename(filePath, '.md'),
    description: data.description || '',
    type: data.metadata?.type || 'unknown',
    body: content.trim(),
    rawContent: raw,
  };
}

export async function createMemory(
  memoryDir: string,
  filename: string,
  meta: { name: string; description: string; type: string },
  body: string,
  configDir?: string,
): Promise<void> {
  await validatePath(memoryDir, configDir);
  const safeName = filename.endsWith('.md') ? filename : `${filename}.md`;
  const filePath = path.join(memoryDir, safeName);

  const content = `---
name: ${meta.name}
description: ${meta.description}
metadata:
  type: ${meta.type}
---

${body}
`;

  await fs.writeFile(filePath, content);
  await updateMemoryIndex(memoryDir, safeName, meta.description, 'add');
}

export async function updateMemory(
  filePath: string,
  rawContent: string,
  configDir?: string,
): Promise<void> {
  await validatePath(filePath, configDir);
  await fs.writeFile(filePath, rawContent);
}

export async function deleteMemory(
  filePath: string,
  memoryDir: string,
  configDir?: string,
): Promise<void> {
  await validatePath(filePath, configDir);
  const filename = path.basename(filePath);
  await fs.rm(filePath, { force: true });
  await updateMemoryIndex(memoryDir, filename, '', 'remove');
}

async function updateMemoryIndex(
  memoryDir: string,
  filename: string,
  description: string,
  action: 'add' | 'remove',
): Promise<void> {
  const indexPath = path.join(memoryDir, 'MEMORY.md');
  let content = '';
  try {
    content = await fs.readFile(indexPath, 'utf-8');
  } catch {
    // Index doesn't exist yet
  }

  const lines = content.split('\n').filter(l => l.trim());

  if (action === 'remove') {
    const filtered = lines.filter(l => !l.includes(filename));
    await fs.writeFile(indexPath, filtered.join('\n') + '\n');
  } else {
    const title = filename.replace('.md', '').split('-').map(
      w => w.charAt(0).toUpperCase() + w.slice(1),
    ).join(' ');
    lines.push(`- [${title}](${filename}) — ${description}`);
    await fs.writeFile(indexPath, lines.join('\n') + '\n');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/memory-manager.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/memory-manager.test.ts src/server/services/memory-manager.ts
git commit -m "feat: implement Claude memory manager with CRUD operations"
```

---

### Task 7: Codex Memory Reader

**Files:**
- Create: `tests/codex-memory.test.ts`
- Create: `src/server/services/codex-memory.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/codex-memory.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { listCodexMemories } from '../src/server/services/codex-memory.js';

let tmpDir: string;
let dbPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-manage-codex-mem-'));
  dbPath = path.join(tmpDir, 'memories_1.sqlite');

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE stage1_outputs (
      thread_id TEXT PRIMARY KEY,
      source_updated_at INTEGER NOT NULL,
      raw_memory TEXT NOT NULL,
      rollout_summary TEXT NOT NULL,
      rollout_slug TEXT,
      generated_at INTEGER NOT NULL,
      usage_count INTEGER,
      last_usage INTEGER,
      selected_for_phase2 INTEGER NOT NULL DEFAULT 0,
      selected_for_phase2_source_updated_at INTEGER
    )
  `);
  db.prepare(
    'INSERT INTO stage1_outputs (thread_id, source_updated_at, raw_memory, rollout_summary, rollout_slug, generated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('thread-001', 1000, 'User likes TDD', 'Testing preference', 'testing', 1000);
  db.close();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('listCodexMemories', () => {
  it('reads memories from SQLite database', () => {
    const memories = listCodexMemories(dbPath);
    expect(memories).toHaveLength(1);
    expect(memories[0].threadId).toBe('thread-001');
    expect(memories[0].rawMemory).toBe('User likes TDD');
    expect(memories[0].rolloutSummary).toBe('Testing preference');
  });

  it('returns empty array when db does not exist', () => {
    const memories = listCodexMemories('/nonexistent/path.sqlite');
    expect(memories).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/codex-memory.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement Codex memory reader**

```typescript
// src/server/services/codex-memory.ts
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import type { CodexMemoryEntry } from '@shared/types.js';

export function getDefaultCodexMemoryPath(): string {
  return path.join(os.homedir(), '.codex', 'memories_1.sqlite');
}

export function listCodexMemories(dbPath?: string): CodexMemoryEntry[] {
  const targetPath = dbPath || getDefaultCodexMemoryPath();

  try {
    const db = new Database(targetPath, { readonly: true });
    try {
      const rows = db
        .prepare(
          'SELECT thread_id, raw_memory, rollout_summary, rollout_slug, generated_at FROM stage1_outputs ORDER BY generated_at DESC',
        )
        .all() as Array<{
        thread_id: string;
        raw_memory: string;
        rollout_summary: string;
        rollout_slug: string | null;
        generated_at: number;
      }>;

      return rows.map(row => ({
        threadId: row.thread_id,
        rawMemory: row.raw_memory,
        rolloutSummary: row.rollout_summary,
        rolloutSlug: row.rollout_slug,
        generatedAt: row.generated_at,
      }));
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/codex-memory.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/codex-memory.test.ts src/server/services/codex-memory.ts
git commit -m "feat: implement Codex memory reader (read-only SQLite)"
```

---

### Task 8: Usage Fetcher

**Files:**
- Create: `tests/usage-fetcher.test.ts`
- Create: `src/server/services/usage-fetcher.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/usage-fetcher.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  readClaudeToken,
  readCodexToken,
  parseClaudeUsageResponse,
  parseCodexUsageResponse,
} from '../src/server/services/usage-fetcher.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-manage-usage-'));
});

describe('readClaudeToken', () => {
  it('reads accessToken from credentials file', async () => {
    const creds = {
      claudeAiOauth: {
        accessToken: 'sk-ant-test-token',
        expiresAt: Date.now() + 3600000,
      },
    };
    await fs.writeFile(
      path.join(tmpDir, '.credentials.json'),
      JSON.stringify(creds),
    );
    const token = await readClaudeToken(tmpDir);
    expect(token).toBe('sk-ant-test-token');
  });

  it('returns null for expired token', async () => {
    const creds = {
      claudeAiOauth: {
        accessToken: 'sk-ant-expired',
        expiresAt: Date.now() - 1000,
      },
    };
    await fs.writeFile(
      path.join(tmpDir, '.credentials.json'),
      JSON.stringify(creds),
    );
    const token = await readClaudeToken(tmpDir);
    expect(token).toBeNull();
  });
});

describe('readCodexToken', () => {
  it('reads access_token from auth.json with chatgpt mode', async () => {
    const auth = {
      auth_mode: 'chatgpt',
      last_refresh: '2026-06-10T00:00:00Z',
      tokens: { access_token: 'eyJ-test-token' },
    };
    await fs.writeFile(path.join(tmpDir, 'auth.json'), JSON.stringify(auth));
    const token = await readCodexToken(tmpDir);
    expect(token).toBe('eyJ-test-token');
  });

  it('returns null for non-chatgpt auth mode', async () => {
    const auth = {
      auth_mode: 'api_key',
      tokens: { access_token: 'test' },
    };
    await fs.writeFile(path.join(tmpDir, 'auth.json'), JSON.stringify(auth));
    const token = await readCodexToken(tmpDir);
    expect(token).toBeNull();
  });
});

describe('parseClaudeUsageResponse', () => {
  it('parses tier data from API response', () => {
    const response = {
      five_hour: { utilization: 0.45, reset_at: '2026-06-13T20:00:00Z' },
      seven_day: { utilization: 0.12, reset_at: '2026-06-19T00:00:00Z' },
    };
    const tiers = parseClaudeUsageResponse(response);
    expect(tiers).toHaveLength(2);
    expect(tiers[0].name).toBe('five_hour');
    expect(tiers[0].utilization).toBe(0.45);
  });
});

describe('parseCodexUsageResponse', () => {
  it('maps window durations to tier names', () => {
    const response = {
      rate_limits: [
        { window_seconds: 18000, utilization: 0.6, reset_at: 1781400000 },
        { window_seconds: 604800, utilization: 0.3, reset_at: 1781900000 },
      ],
    };
    const tiers = parseCodexUsageResponse(response);
    expect(tiers).toHaveLength(2);
    expect(tiers[0].name).toBe('five_hour');
    expect(tiers[0].utilization).toBe(0.6);
    expect(tiers[1].name).toBe('seven_day');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/usage-fetcher.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement usage fetcher**

```typescript
// src/server/services/usage-fetcher.ts
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { UsageTier, ProviderUsage } from '@shared/types.js';

const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const CODEX_TOKEN_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000; // 8 days

const TIER_LABELS: Record<string, string> = {
  five_hour: '5 Hour',
  seven_day: '7 Day',
  seven_day_opus: '7 Day (Opus)',
  seven_day_sonnet: '7 Day (Sonnet)',
};

const CODEX_WINDOW_MAP: Record<number, string> = {
  18000: 'five_hour',
  604800: 'seven_day',
};

// Token cache (10s TTL to prevent concurrent duplicate requests)
let usageCache: { claude?: { data: ProviderUsage; ts: number }; codex?: { data: ProviderUsage; ts: number } } = {};
const CACHE_TTL = 10_000;

export async function readClaudeToken(claudeDir?: string): Promise<string | null> {
  const dir = claudeDir || path.join(os.homedir(), '.claude');
  try {
    const raw = await fs.readFile(path.join(dir, '.credentials.json'), 'utf-8');
    const creds = JSON.parse(raw);
    const oauth = creds.claudeAiOauth || creds['claude.ai_oauth'];
    if (!oauth?.accessToken) return null;

    if (oauth.expiresAt && oauth.expiresAt < Date.now()) return null;

    return oauth.accessToken;
  } catch {
    return null;
  }
}

export async function readCodexToken(codexDir?: string): Promise<string | null> {
  const dir = codexDir || path.join(os.homedir(), '.codex');
  try {
    const raw = await fs.readFile(path.join(dir, 'auth.json'), 'utf-8');
    const auth = JSON.parse(raw);
    if (auth.auth_mode !== 'chatgpt') return null;

    if (auth.last_refresh) {
      const refreshTime = new Date(auth.last_refresh).getTime();
      if (Date.now() - refreshTime > CODEX_TOKEN_MAX_AGE_MS) return null;
    }

    return auth.tokens?.access_token || null;
  } catch {
    return null;
  }
}

export function parseClaudeUsageResponse(data: any): UsageTier[] {
  const tiers: UsageTier[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'object' || value === null) continue;
    const tier = value as any;
    if (typeof tier.utilization !== 'number') continue;
    tiers.push({
      name: key,
      label: TIER_LABELS[key] || key,
      utilization: tier.utilization,
      resetAt: tier.reset_at ? new Date(tier.reset_at).getTime() : 0,
    });
  }
  return tiers;
}

export function parseCodexUsageResponse(data: any): UsageTier[] {
  const tiers: UsageTier[] = [];
  const rateLimits = data.rate_limits || data.rateLimits || [];

  for (const rl of rateLimits) {
    const name = CODEX_WINDOW_MAP[rl.window_seconds] || `${rl.window_seconds}s`;
    tiers.push({
      name,
      label: TIER_LABELS[name] || name,
      utilization: rl.utilization || 0,
      resetAt: typeof rl.reset_at === 'number'
        ? rl.reset_at * 1000
        : new Date(rl.reset_at).getTime(),
    });
  }

  return tiers;
}

export async function fetchClaudeUsage(): Promise<ProviderUsage> {
  const cached = usageCache.claude;
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const token = await readClaudeToken();
  if (!token) {
    return { provider: 'claude', tiers: [], tokenExpired: true };
  }

  try {
    const res = await fetch(CLAUDE_USAGE_URL, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      return { provider: 'claude', tiers: [], error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    const result: ProviderUsage = {
      provider: 'claude',
      tiers: parseClaudeUsageResponse(data),
    };
    usageCache.claude = { data: result, ts: Date.now() };
    return result;
  } catch (err: any) {
    return { provider: 'claude', tiers: [], error: err.message };
  }
}

export async function fetchCodexUsage(): Promise<ProviderUsage> {
  const cached = usageCache.codex;
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const token = await readCodexToken();
  if (!token) {
    return { provider: 'codex', tiers: [], tokenExpired: true };
  }

  try {
    const res = await fetch(CODEX_USAGE_URL, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      return { provider: 'codex', tiers: [], error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    const result: ProviderUsage = {
      provider: 'codex',
      tiers: parseCodexUsageResponse(data),
    };
    usageCache.codex = { data: result, ts: Date.now() };
    return result;
  } catch (err: any) {
    return { provider: 'codex', tiers: [], error: err.message };
  }
}

export async function fetchAllUsage(): Promise<ProviderUsage[]> {
  const [claude, codex] = await Promise.all([fetchClaudeUsage(), fetchCodexUsage()]);
  return [claude, codex];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/usage-fetcher.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/usage-fetcher.test.ts src/server/services/usage-fetcher.ts
git commit -m "feat: implement usage fetcher with OAuth token reading and API parsing"
```

---

### Task 9: API Routes

**Files:**
- Create: `src/server/routes/sessions.ts`
- Create: `src/server/routes/memory.ts`
- Create: `src/server/routes/usage.ts`
- Create: `tests/routes/sessions.test.ts`
- Create: `tests/routes/memory.test.ts`
- Create: `tests/routes/usage.test.ts`

- [ ] **Step 1: Write session route tests**

```typescript
// tests/routes/sessions.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { sessionsRoutes } from '../../src/server/routes/sessions.js';

let tmpDir: string;
let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-manage-routes-'));
  const projectDir = path.join(tmpDir, 'projects', '-home-user-proj');
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(
    path.join(projectDir, 'sess-001.jsonl'),
    [
      '{"type":"queue-operation","operation":"enqueue","timestamp":"2026-06-01T02:40:05.900Z","sessionId":"sess-001"}',
      '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Hello"}]},"cwd":"/home/user/proj","timestamp":"2026-06-01T02:40:06.000Z","sessionId":"sess-001"}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hi!"}]},"timestamp":"2026-06-01T02:41:00.000Z"}',
    ].join('\n'),
  );

  app = Fastify();
  await app.register(sessionsRoutes, { claudeConfigDir: tmpDir, codexConfigDir: path.join(tmpDir, 'codex-empty') });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('GET /api/sessions', () => {
  it('returns grouped sessions', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sessions' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });
});

describe('GET /api/sessions/:provider/:id/messages', () => {
  it('returns messages for a session', async () => {
    const listRes = await app.inject({ method: 'GET', url: '/api/sessions' });
    const groups = listRes.json();
    const session = groups[0].projects[0].sessions[0];
    const res = await app.inject({
      method: 'GET',
      url: `/api/sessions/claude/${session.id}/messages`,
    });
    expect(res.statusCode).toBe(200);
    const messages = res.json();
    expect(messages.length).toBe(2);
  });
});

describe('PATCH /api/sessions/:provider/:id', () => {
  it('renames a session title', async () => {
    const listRes = await app.inject({ method: 'GET', url: '/api/sessions' });
    const session = listRes.json()[0].projects[0].sessions[0];
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/sessions/claude/${session.id}`,
      payload: { title: 'Renamed Title' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('DELETE /api/sessions/:provider/:id', () => {
  it('deletes a session', async () => {
    const listRes = await app.inject({ method: 'GET', url: '/api/sessions' });
    const session = listRes.json()[0].projects[0].sessions[0];
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/sessions/claude/${session.id}`,
    });
    expect(res.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Implement sessions routes**

```typescript
// src/server/routes/sessions.ts
import type { FastifyPluginAsync } from 'fastify';
import type { ProviderGroup, Provider } from '@shared/types.js';
import { discoverClaudeSessions, getClaudeMessages, deleteClaudeSession, renameClaudeSession } from '../providers/claude.js';
import { discoverCodexSessions, getCodexMessages, deleteCodexSession } from '../providers/codex.js';

interface RouteOpts {
  claudeConfigDir?: string;
  codexConfigDir?: string;
}

export const sessionsRoutes: FastifyPluginAsync<RouteOpts> = async (fastify, opts) => {
  // In-memory session map for resolving IDs to file paths
  let sessionMap = new Map<string, { provider: Provider; filePath: string }>();

  async function refreshSessionMap() {
    const [claudeSessions, codexSessions] = await Promise.all([
      discoverClaudeSessions(opts.claudeConfigDir),
      discoverCodexSessions(opts.codexConfigDir),
    ]);
    sessionMap = new Map();
    for (const s of [...claudeSessions, ...codexSessions]) {
      sessionMap.set(`${s.provider}:${s.id}`, { provider: s.provider, filePath: s.filePath });
    }

    const groups: ProviderGroup[] = [];
    for (const [provider, sessions] of [
      ['claude' as Provider, claudeSessions],
      ['codex' as Provider, codexSessions],
    ] as const) {
      const projectMap = new Map<string, typeof sessions>();
      for (const s of sessions) {
        const key = s.cwd || s.project;
        if (!projectMap.has(key)) projectMap.set(key, []);
        projectMap.get(key)!.push(s);
      }
      groups.push({
        provider,
        projects: Array.from(projectMap.entries()).map(([cwd, sess]) => ({
          name: sess[0].project,
          cwd,
          sessions: sess,
        })),
      });
    }
    return groups;
  }

  fastify.get('/api/sessions', async () => {
    return refreshSessionMap();
  });

  fastify.get<{ Params: { provider: string; id: string } }>(
    '/api/sessions/:provider/:id/messages',
    async (req, reply) => {
      const key = `${req.params.provider}:${req.params.id}`;
      const entry = sessionMap.get(key);
      if (!entry) {
        // Try refresh
        await refreshSessionMap();
        const retryEntry = sessionMap.get(key);
        if (!retryEntry) return reply.status(404).send({ error: 'Session not found' });
        return retryEntry.provider === 'claude'
          ? getClaudeMessages(retryEntry.filePath)
          : getCodexMessages(retryEntry.filePath);
      }
      return entry.provider === 'claude'
        ? getClaudeMessages(entry.filePath)
        : getCodexMessages(entry.filePath);
    },
  );

  fastify.patch<{ Params: { provider: string; id: string }; Body: { title: string } }>(
    '/api/sessions/:provider/:id',
    async (req, reply) => {
      const key = `${req.params.provider}:${req.params.id}`;
      let entry = sessionMap.get(key);
      if (!entry) {
        await refreshSessionMap();
        entry = sessionMap.get(key);
      }
      if (!entry) return reply.status(404).send({ error: 'Session not found' });
      if (entry.provider !== 'claude') {
        return reply.status(400).send({ error: 'Rename only supported for Claude sessions' });
      }
      await renameClaudeSession(entry.filePath, req.body.title);
      return { ok: true };
    },
  );

  fastify.delete<{ Params: { provider: string; id: string } }>(
    '/api/sessions/:provider/:id',
    async (req, reply) => {
      const key = `${req.params.provider}:${req.params.id}`;
      let entry = sessionMap.get(key);
      if (!entry) {
        await refreshSessionMap();
        entry = sessionMap.get(key);
      }
      if (!entry) return reply.status(404).send({ error: 'Session not found' });
      if (entry.provider === 'claude') {
        await deleteClaudeSession(entry.filePath);
      } else {
        await deleteCodexSession(entry.filePath);
      }
      sessionMap.delete(key);
      return { ok: true };
    },
  );

  fastify.post<{ Body: { ids: Array<{ provider: string; id: string }> } }>(
    '/api/sessions/batch-delete',
    async (req) => {
      const results: Array<{ provider: string; id: string; ok: boolean; error?: string }> = [];
      for (const { provider, id } of req.body.ids) {
        const key = `${provider}:${id}`;
        const entry = sessionMap.get(key);
        if (!entry) {
          results.push({ provider, id, ok: false, error: 'Not found' });
          continue;
        }
        try {
          if (entry.provider === 'claude') {
            await deleteClaudeSession(entry.filePath);
          } else {
            await deleteCodexSession(entry.filePath);
          }
          sessionMap.delete(key);
          results.push({ provider, id, ok: true });
        } catch (err: any) {
          results.push({ provider, id, ok: false, error: err.message });
        }
      }
      return { results };
    },
  );
};
```

- [ ] **Step 3: Implement memory routes**

```typescript
// src/server/routes/memory.ts
import type { FastifyPluginAsync } from 'fastify';
import {
  listMemoryProjects,
  listMemories,
  readMemory,
  createMemory,
  updateMemory,
  deleteMemory,
} from '../services/memory-manager.js';
import { listCodexMemories } from '../services/codex-memory.js';

interface RouteOpts {
  claudeConfigDir?: string;
  codexMemoryDbPath?: string;
}

export const memoryRoutes: FastifyPluginAsync<RouteOpts> = async (fastify, opts) => {
  fastify.get('/api/memory/claude', async () => {
    return listMemoryProjects(opts.claudeConfigDir);
  });

  fastify.get<{ Params: { project: string } }>(
    '/api/memory/claude/:project',
    async (req, reply) => {
      const projects = await listMemoryProjects(opts.claudeConfigDir);
      const proj = projects.find(p => p.project === req.params.project);
      if (!proj) return reply.status(404).send({ error: 'Project not found' });
      return proj.memories;
    },
  );

  fastify.get<{ Params: { project: string; file: string } }>(
    '/api/memory/claude/:project/:file',
    async (req, reply) => {
      const projects = await listMemoryProjects(opts.claudeConfigDir);
      const proj = projects.find(p => p.project === req.params.project);
      if (!proj) return reply.status(404).send({ error: 'Project not found' });
      const filePath = `${proj.projectDir}/${req.params.file}`;
      return readMemory(filePath, opts.claudeConfigDir);
    },
  );

  fastify.post<{
    Params: { project: string };
    Body: { filename: string; name: string; description: string; type: string; body: string };
  }>('/api/memory/claude/:project', async (req, reply) => {
    const projects = await listMemoryProjects(opts.claudeConfigDir);
    const proj = projects.find(p => p.project === req.params.project);
    if (!proj) return reply.status(404).send({ error: 'Project not found' });
    await createMemory(
      proj.projectDir,
      req.body.filename,
      { name: req.body.name, description: req.body.description, type: req.body.type },
      req.body.body,
      opts.claudeConfigDir,
    );
    return { ok: true };
  });

  fastify.put<{ Params: { project: string; file: string }; Body: { content: string } }>(
    '/api/memory/claude/:project/:file',
    async (req, reply) => {
      const projects = await listMemoryProjects(opts.claudeConfigDir);
      const proj = projects.find(p => p.project === req.params.project);
      if (!proj) return reply.status(404).send({ error: 'Project not found' });
      const filePath = `${proj.projectDir}/${req.params.file}`;
      await updateMemory(filePath, req.body.content, opts.claudeConfigDir);
      return { ok: true };
    },
  );

  fastify.delete<{ Params: { project: string; file: string } }>(
    '/api/memory/claude/:project/:file',
    async (req, reply) => {
      const projects = await listMemoryProjects(opts.claudeConfigDir);
      const proj = projects.find(p => p.project === req.params.project);
      if (!proj) return reply.status(404).send({ error: 'Project not found' });
      const filePath = `${proj.projectDir}/${req.params.file}`;
      await deleteMemory(filePath, proj.projectDir, opts.claudeConfigDir);
      return { ok: true };
    },
  );

  fastify.get('/api/memory/codex', async () => {
    return listCodexMemories(opts.codexMemoryDbPath);
  });
};
```

- [ ] **Step 4: Implement usage routes**

```typescript
// src/server/routes/usage.ts
import type { FastifyPluginAsync } from 'fastify';
import { fetchClaudeUsage, fetchCodexUsage, fetchAllUsage } from '../services/usage-fetcher.js';

export const usageRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/usage', async () => {
    return fetchAllUsage();
  });

  fastify.get<{ Params: { provider: string } }>(
    '/api/usage/:provider',
    async (req, reply) => {
      if (req.params.provider === 'claude') return fetchClaudeUsage();
      if (req.params.provider === 'codex') return fetchCodexUsage();
      return reply.status(400).send({ error: 'Unknown provider' });
    },
  );
};
```

- [ ] **Step 5: Run session route tests**

Run: `npx vitest run tests/routes/sessions.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/ tests/routes/
git commit -m "feat: implement API routes for sessions, memory, and usage"
```

---

### Task 10: Fastify Server Setup

**Files:**
- Create: `src/server/index.ts`

- [ ] **Step 1: Implement server entry**

```typescript
// src/server/index.ts
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { sessionsRoutes } from './routes/sessions.js';
import { memoryRoutes } from './routes/memory.js';
import { usageRoutes } from './routes/usage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createServer(opts: { port?: number } = {}) {
  const port = opts.port || 3456;
  const app = Fastify({ logger: true });

  await app.register(fastifyCors, { origin: true });
  await app.register(sessionsRoutes);
  await app.register(memoryRoutes);
  await app.register(usageRoutes);

  // Serve pre-built client in production
  const clientDir = path.join(__dirname, '..', 'client');
  try {
    await app.register(fastifyStatic, {
      root: clientDir,
      prefix: '/',
      wildcard: false,
    });
    // SPA fallback: serve index.html for any unmatched non-API route
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.status(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  } catch {
    app.log.warn('Client build not found, running in API-only mode');
    app.setNotFoundHandler((req, reply) => {
      return reply.status(404).send({ error: 'Not found' });
    });
  }

  await app.listen({ port, host: '127.0.0.1' });
  app.log.info(`cc-manage running at http://127.0.0.1:${port}`);

  return app;
}

// Allow direct execution for development
if (process.argv[1] && (
  process.argv[1].endsWith('src/server/index.ts') ||
  process.argv[1].endsWith('dist/server/index.js')
)) {
  const port = parseInt(process.env.PORT || '3456', 10);
  createServer({ port }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Verify server starts**

Run: `npx tsx src/server/index.ts &` (wait 2 seconds, then `curl http://127.0.0.1:3456/api/sessions`, then kill the process)
Expected: JSON response with session data.

- [ ] **Step 3: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: implement Fastify server with static file serving and SPA fallback"
```

---

### Task 11: CLI Entry Point

**Files:**
- Create: `bin/cc-manage.ts`

- [ ] **Step 1: Implement CLI with start/stop/status**

```typescript
#!/usr/bin/env node
// bin/cc-manage.ts
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const PID_DIR = path.join(os.homedir(), '.cc-manage');
const PID_FILE = path.join(PID_DIR, 'cc-manage.pid');
const LOG_FILE = path.join(PID_DIR, 'cc-manage.log');

function ensurePidDir() {
  if (!fs.existsSync(PID_DIR)) {
    fs.mkdirSync(PID_DIR, { recursive: true });
  }
}

function readPid(): number | null {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
    if (isNaN(pid)) return null;
    // Check if process is alive
    try {
      process.kill(pid, 0);
      return pid;
    } catch {
      fs.unlinkSync(PID_FILE);
      return null;
    }
  } catch {
    return null;
  }
}

function start(port: number) {
  const existingPid = readPid();
  if (existingPid) {
    console.log(`cc-manage is already running (PID: ${existingPid})`);
    return;
  }

  ensurePidDir();

  const serverScript = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'server',
    'index.js',
  );

  const logFd = fs.openSync(LOG_FILE, 'a');
  const child = spawn('node', [serverScript], {
    env: { ...process.env, PORT: String(port) },
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });

  if (child.pid) {
    fs.writeFileSync(PID_FILE, String(child.pid));
    console.log(`cc-manage started on http://127.0.0.1:${port} (PID: ${child.pid})`);
    console.log(`Logs: ${LOG_FILE}`);
  }

  child.unref();
  fs.closeSync(logFd);
}

function stop() {
  const pid = readPid();
  if (!pid) {
    console.log('cc-manage is not running');
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
    fs.unlinkSync(PID_FILE);
    console.log(`cc-manage stopped (PID: ${pid})`);
  } catch (err: any) {
    console.error(`Failed to stop: ${err.message}`);
  }
}

function status() {
  const pid = readPid();
  if (pid) {
    console.log(`cc-manage is running (PID: ${pid})`);
  } else {
    console.log('cc-manage is not running');
  }
}

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'start': {
    const portIdx = args.indexOf('--port');
    const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 3456;
    start(port);
    break;
  }
  case 'stop':
    stop();
    break;
  case 'status':
    status();
    break;
  default:
    console.log(`cc-manage - Claude Code & Codex Management Tool

Usage:
  cc-manage start [--port 3456]    Start the web server
  cc-manage stop                   Stop the server
  cc-manage status                 Check server status`);
}
```

- [ ] **Step 2: Commit**

```bash
git add bin/cc-manage.ts
git commit -m "feat: implement CLI entry point with start/stop/status commands"
```

---

### Task 12: Frontend Shell

**Files:**
- Create: `src/client/index.html`
- Create: `src/client/index.css`
- Create: `src/client/main.tsx`
- Create: `src/client/App.tsx`
- Create: `src/client/lib/api.ts`
- Create: `src/client/components/Layout.tsx`

- [ ] **Step 1: Create index.html**

```html
<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>cc-manage</title>
  </head>
  <body class="bg-zinc-950 text-zinc-100">
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create CSS with Tailwind**

```css
/* src/client/index.css */
@import "tailwindcss";

@theme {
  --color-primary: #3b82f6;
  --color-danger: #ef4444;
  --color-success: #22c55e;
  --color-warning: #f59e0b;
}
```

- [ ] **Step 3: Create React entry and App component**

```tsx
// src/client/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

```tsx
// src/client/App.tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Sessions from './pages/Sessions';
import Memory from './pages/Memory';
import Usage from './pages/Usage';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/sessions" element={<Sessions />} />
        <Route path="/memory" element={<Memory />} />
        <Route path="/usage" element={<Usage />} />
        <Route path="*" element={<Navigate to="/sessions" replace />} />
      </Routes>
    </Layout>
  );
}
```

- [ ] **Step 4: Create API client**

```typescript
// src/client/lib/api.ts
const BASE = '/api';

async function request<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  sessions: {
    list: () => request<any[]>('/sessions'),
    messages: (provider: string, id: string) =>
      request<any[]>(`/sessions/${provider}/${id}/messages`),
    rename: (provider: string, id: string, title: string) =>
      request<any>(`/sessions/${provider}/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      }),
    delete: (provider: string, id: string) =>
      request<any>(`/sessions/${provider}/${id}`, { method: 'DELETE' }),
    batchDelete: (ids: Array<{ provider: string; id: string }>) =>
      request<any>('/sessions/batch-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),
  },
  memory: {
    claudeProjects: () => request<any[]>('/memory/claude'),
    claudeRead: (project: string, file: string) =>
      request<any>(`/memory/claude/${project}/${file}`),
    claudeCreate: (project: string, data: any) =>
      request<any>(`/memory/claude/${project}`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    claudeUpdate: (project: string, file: string, content: string) =>
      request<any>(`/memory/claude/${project}/${file}`, {
        method: 'PUT',
        body: JSON.stringify({ content }),
      }),
    claudeDelete: (project: string, file: string) =>
      request<any>(`/memory/claude/${project}/${file}`, { method: 'DELETE' }),
    codexList: () => request<any[]>('/memory/codex'),
  },
  usage: {
    all: () => request<any[]>('/usage'),
    provider: (provider: string) => request<any>(`/usage/${provider}`),
  },
};
```

- [ ] **Step 5: Create Layout component**

```tsx
// src/client/components/Layout.tsx
import { NavLink } from 'react-router-dom';
import { MessageSquare, Brain, BarChart3 } from 'lucide-react';
import type { ReactNode } from 'react';

const tabs = [
  { to: '/sessions', label: 'Sessions', icon: MessageSquare },
  { to: '/memory', label: 'Memory', icon: Brain },
  { to: '/usage', label: 'Usage', icon: BarChart3 },
];

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="h-screen flex flex-col">
      <header className="flex items-center gap-1 px-4 py-2 bg-zinc-900 border-b border-zinc-800">
        <span className="text-sm font-bold text-zinc-400 mr-4">cc-manage</span>
        {tabs.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${
                isActive
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`
            }
          >
            <Icon size={14} />
            {label}
          </NavLink>
        ))}
      </header>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
```

- [ ] **Step 6: Verify dev server starts**

Run: `npx vite --config vite.config.ts` (from project root)
Expected: Vite dev server starts, page loads at localhost:5173 with tab bar visible.

- [ ] **Step 7: Commit**

```bash
git add src/client/
git commit -m "feat: scaffold frontend with React, Tailwind, routing, and layout"
```

---

### Task 13: Sessions Page

**Files:**
- Create: `src/client/pages/Sessions.tsx`

- [ ] **Step 1: Implement Sessions page with tree list and viewer**

```tsx
// src/client/pages/Sessions.tsx
import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, ChevronDown, Trash2, Check, X, Search } from 'lucide-react';
import { api } from '../lib/api';

interface SessionMeta {
  id: string;
  provider: string;
  title: string;
  project: string;
  lastActivity: number;
}

interface Message {
  role: string;
  content: string;
  timestamp: number;
}

export default function Sessions() {
  const [groups, setGroups] = useState<any[]>([]);
  const [selected, setSelected] = useState<SessionMeta | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.sessions.list();
      setGroups(data);
      // Auto-expand all providers
      const keys = new Set<string>();
      data.forEach((g: any) => keys.add(g.provider));
      setExpanded(keys);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const loadMessages = async (session: SessionMeta) => {
    setSelected(session);
    const msgs = await api.sessions.messages(session.provider, session.id);
    setMessages(msgs);
  };

  const handleDelete = async (provider: string, id: string) => {
    if (!confirm('Delete this session?')) return;
    await api.sessions.delete(provider, id);
    if (selected?.id === id) { setSelected(null); setMessages([]); }
    loadSessions();
  };

  const handleBatchDelete = async () => {
    if (!confirm(`Delete ${selectedIds.size} sessions?`)) return;
    const ids = Array.from(selectedIds).map(key => {
      const [provider, id] = key.split(':');
      return { provider, id };
    });
    await api.sessions.batchDelete(ids);
    setSelectedIds(new Set());
    setSelectMode(false);
    setSelected(null);
    setMessages([]);
    loadSessions();
  };

  const handleRename = async (provider: string, id: string) => {
    if (!newTitle.trim()) return;
    await api.sessions.rename(provider, id, newTitle.trim());
    setEditingTitle(null);
    loadSessions();
  };

  const toggleExpand = (key: string) => {
    const next = new Set(expanded);
    next.has(key) ? next.delete(key) : next.add(key);
    setExpanded(next);
  };

  const toggleSelect = (key: string) => {
    const next = new Set(selectedIds);
    next.has(key) ? next.delete(key) : next.add(key);
    setSelectedIds(next);
  };

  const formatTime = (ts: number) => {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const filteredGroups = groups.map((g: any) => ({
    ...g,
    projects: g.projects.map((p: any) => ({
      ...p,
      sessions: p.sessions.filter((s: any) =>
        s.title.toLowerCase().includes(search.toLowerCase()),
      ),
    })).filter((p: any) => p.sessions.length > 0),
  })).filter((g: any) => g.projects.length > 0);

  return (
    <div className="flex h-full">
      {/* Left panel: session tree */}
      <div className="w-80 border-r border-zinc-800 flex flex-col">
        <div className="p-2 border-b border-zinc-800 flex gap-2">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full pl-7 pr-2 py-1 text-sm bg-zinc-900 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
            />
          </div>
          {selectMode ? (
            <div className="flex gap-1">
              <button onClick={handleBatchDelete} className="px-2 py-1 text-xs bg-red-600 rounded hover:bg-red-500" title="Delete selected">
                <Trash2 size={12} />
              </button>
              <button onClick={() => { setSelectMode(false); setSelectedIds(new Set()); }} className="px-2 py-1 text-xs bg-zinc-700 rounded hover:bg-zinc-600">
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => setSelectMode(true)} className="px-2 py-1 text-xs text-zinc-400 bg-zinc-800 rounded hover:bg-zinc-700">
              Select
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto text-sm">
          {loading ? (
            <div className="p-4 text-zinc-500">Loading...</div>
          ) : filteredGroups.length === 0 ? (
            <div className="p-4 text-zinc-500">No sessions found</div>
          ) : (
            filteredGroups.map((group: any) => (
              <div key={group.provider}>
                <button
                  onClick={() => toggleExpand(group.provider)}
                  className="flex items-center gap-1 w-full px-2 py-1.5 text-zinc-400 hover:bg-zinc-900 font-medium uppercase text-xs"
                >
                  {expanded.has(group.provider) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  {group.provider === 'claude' ? 'Claude Code' : 'Codex'}
                  <span className="ml-auto text-zinc-600">{group.projects.reduce((n: number, p: any) => n + p.sessions.length, 0)}</span>
                </button>
                {expanded.has(group.provider) && group.projects.map((proj: any) => {
                  const projKey = `${group.provider}:${proj.name}`;
                  return (
                    <div key={projKey}>
                      <button
                        onClick={() => toggleExpand(projKey)}
                        className="flex items-center gap-1 w-full px-4 py-1 text-zinc-400 hover:bg-zinc-900 text-xs"
                      >
                        {expanded.has(projKey) ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                        {proj.name}
                        <span className="ml-auto text-zinc-600">{proj.sessions.length}</span>
                      </button>
                      {expanded.has(projKey) && proj.sessions.map((s: SessionMeta) => {
                        const sKey = `${s.provider}:${s.id}`;
                        return (
                          <div
                            key={s.id}
                            className={`flex items-center gap-1 px-6 py-1.5 cursor-pointer hover:bg-zinc-800 group ${
                              selected?.id === s.id ? 'bg-zinc-800' : ''
                            }`}
                            onClick={() => selectMode ? toggleSelect(sKey) : loadMessages(s)}
                          >
                            {selectMode && (
                              <input
                                type="checkbox"
                                checked={selectedIds.has(sKey)}
                                onChange={() => toggleSelect(sKey)}
                                className="mr-1"
                              />
                            )}
                            <div className="flex-1 min-w-0">
                              {editingTitle === s.id ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    value={newTitle}
                                    onChange={e => setNewTitle(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleRename(s.provider, s.id)}
                                    className="flex-1 px-1 py-0.5 text-xs bg-zinc-900 border border-zinc-600 rounded text-zinc-200"
                                    autoFocus
                                    onClick={e => e.stopPropagation()}
                                  />
                                  <button onClick={e => { e.stopPropagation(); handleRename(s.provider, s.id); }}><Check size={10} className="text-green-500" /></button>
                                  <button onClick={e => { e.stopPropagation(); setEditingTitle(null); }}><X size={10} className="text-zinc-500" /></button>
                                </div>
                              ) : (
                                <div
                                  className="truncate text-zinc-300"
                                  onDoubleClick={e => {
                                    if (s.provider === 'claude') {
                                      e.stopPropagation();
                                      setEditingTitle(s.id);
                                      setNewTitle(s.title);
                                    }
                                  }}
                                  title={s.title}
                                >
                                  {s.title}
                                </div>
                              )}
                              <div className="text-zinc-600 text-[10px]">{formatTime(s.lastActivity)}</div>
                            </div>
                            {!selectMode && (
                              <button
                                onClick={e => { e.stopPropagation(); handleDelete(s.provider, s.id); }}
                                className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 text-zinc-600"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right panel: message viewer */}
      <div className="flex-1 overflow-y-auto p-4">
        {selected ? (
          <div className="max-w-3xl mx-auto space-y-4">
            <h2 className="text-lg font-medium text-zinc-200 mb-4">{selected.title}</h2>
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`rounded-lg p-3 text-sm ${
                  msg.role === 'user'
                    ? 'bg-blue-950/30 border border-blue-900/30'
                    : 'bg-zinc-900 border border-zinc-800'
                }`}
              >
                <div className="text-xs text-zinc-500 mb-1">
                  {msg.role === 'user' ? 'You' : 'Assistant'}
                  {msg.timestamp ? ` · ${formatTime(msg.timestamp)}` : ''}
                </div>
                <div className="text-zinc-300 whitespace-pre-wrap break-words">{msg.content}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-600">
            Select a session to view
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify page renders**

Run: `npx concurrently "npx tsx src/server/index.ts" "npx vite"`
Expected: Navigate to http://localhost:5173/sessions — tree list shows Claude/Codex sessions, clicking loads messages.

- [ ] **Step 3: Commit**

```bash
git add src/client/pages/Sessions.tsx
git commit -m "feat: implement Sessions page with tree list, viewer, delete, and rename"
```

---

### Task 14: Memory Page

**Files:**
- Create: `src/client/pages/Memory.tsx`

- [ ] **Step 1: Implement Memory page with file tree and editor**

```tsx
// src/client/pages/Memory.tsx
import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, ChevronDown, Plus, Trash2, Save, FileText } from 'lucide-react';
import { api } from '../lib/api';

interface MemoryProject {
  project: string;
  projectDir: string;
  memories: Array<{ filename: string; name: string; description: string; type: string }>;
}

export default function Memory() {
  const [claudeProjects, setClaudeProjects] = useState<MemoryProject[]>([]);
  const [codexMemories, setCodexMemories] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<{ project: string; filename: string; provider: 'claude' | 'codex' } | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState<string | null>(null);
  const [newMemory, setNewMemory] = useState({ filename: '', name: '', description: '', type: 'project', body: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [claude, codex] = await Promise.all([
        api.memory.claudeProjects(),
        api.memory.codexList(),
      ]);
      setClaudeProjects(claude);
      setCodexMemories(codex);
      const keys = new Set<string>();
      keys.add('claude');
      if (codex.length > 0) keys.add('codex');
      setExpanded(keys);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const selectMemory = async (project: string, filename: string) => {
    setSelectedFile({ project, filename, provider: 'claude' });
    const data = await api.memory.claudeRead(project, filename);
    setEditorContent(data.rawContent);
    setOriginalContent(data.rawContent);
  };

  const selectCodexMemory = (entry: any) => {
    setSelectedFile({ project: '', filename: entry.threadId, provider: 'codex' });
    setEditorContent(`# ${entry.rolloutSummary}\n\nSlug: ${entry.rolloutSlug || 'none'}\n\n---\n\n${entry.rawMemory}`);
    setOriginalContent('');
  };

  const handleSave = async () => {
    if (!selectedFile || selectedFile.provider !== 'claude') return;
    await api.memory.claudeUpdate(selectedFile.project, selectedFile.filename, editorContent);
    setOriginalContent(editorContent);
  };

  const handleDelete = async (project: string, filename: string) => {
    if (!confirm(`Delete memory "${filename}"?`)) return;
    await api.memory.claudeDelete(project, filename);
    if (selectedFile?.filename === filename) {
      setSelectedFile(null);
      setEditorContent('');
    }
    loadData();
  };

  const handleCreate = async (project: string) => {
    await api.memory.claudeCreate(project, newMemory);
    setShowCreate(null);
    setNewMemory({ filename: '', name: '', description: '', type: 'project', body: '' });
    loadData();
  };

  const toggleExpand = (key: string) => {
    const next = new Set(expanded);
    next.has(key) ? next.delete(key) : next.add(key);
    setExpanded(next);
  };

  const hasChanges = selectedFile?.provider === 'claude' && editorContent !== originalContent;

  return (
    <div className="flex h-full">
      {/* Left panel: file tree */}
      <div className="w-72 border-r border-zinc-800 overflow-y-auto text-sm">
        {loading ? (
          <div className="p-4 text-zinc-500">Loading...</div>
        ) : (
          <>
            {/* Claude memories */}
            <button onClick={() => toggleExpand('claude')} className="flex items-center gap-1 w-full px-2 py-1.5 text-zinc-400 hover:bg-zinc-900 font-medium uppercase text-xs">
              {expanded.has('claude') ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Claude Code
            </button>
            {expanded.has('claude') && claudeProjects.map(proj => {
              const projKey = `claude:${proj.project}`;
              return (
                <div key={proj.project}>
                  <div className="flex items-center">
                    <button onClick={() => toggleExpand(projKey)} className="flex-1 flex items-center gap-1 px-4 py-1 text-zinc-400 hover:bg-zinc-900 text-xs">
                      {expanded.has(projKey) ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                      {proj.project}
                    </button>
                    <button onClick={() => setShowCreate(proj.project)} className="px-1 mr-1 text-zinc-600 hover:text-zinc-400">
                      <Plus size={12} />
                    </button>
                  </div>
                  {expanded.has(projKey) && (
                    <>
                      {proj.memories.map(mem => (
                        <div
                          key={mem.filename}
                          className={`flex items-center gap-1 px-6 py-1 cursor-pointer hover:bg-zinc-800 group ${
                            selectedFile?.filename === mem.filename ? 'bg-zinc-800' : ''
                          }`}
                          onClick={() => selectMemory(proj.project, mem.filename)}
                        >
                          <FileText size={10} className="text-zinc-600 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="truncate text-zinc-300">{mem.name}</div>
                            <div className="truncate text-zinc-600 text-[10px]">{mem.description}</div>
                          </div>
                          <button
                            onClick={e => { e.stopPropagation(); handleDelete(proj.project, mem.filename); }}
                            className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 text-zinc-600"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                      ))}
                      {showCreate === proj.project && (
                        <div className="px-4 py-2 bg-zinc-900 border-t border-zinc-800 space-y-1">
                          <input value={newMemory.filename} onChange={e => setNewMemory(p => ({ ...p, filename: e.target.value, name: e.target.value }))} placeholder="filename (no .md)" className="w-full px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-200" />
                          <input value={newMemory.description} onChange={e => setNewMemory(p => ({ ...p, description: e.target.value }))} placeholder="description" className="w-full px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-200" />
                          <select value={newMemory.type} onChange={e => setNewMemory(p => ({ ...p, type: e.target.value }))} className="w-full px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-200">
                            <option value="user">user</option>
                            <option value="feedback">feedback</option>
                            <option value="project">project</option>
                            <option value="reference">reference</option>
                          </select>
                          <textarea value={newMemory.body} onChange={e => setNewMemory(p => ({ ...p, body: e.target.value }))} placeholder="body" rows={3} className="w-full px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-200 font-mono" />
                          <div className="flex gap-1">
                            <button onClick={() => handleCreate(proj.project)} className="px-2 py-1 text-xs bg-blue-600 rounded hover:bg-blue-500">Create</button>
                            <button onClick={() => setShowCreate(null)} className="px-2 py-1 text-xs bg-zinc-700 rounded hover:bg-zinc-600">Cancel</button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}

            {/* Codex memories */}
            {codexMemories.length > 0 && (
              <>
                <button onClick={() => toggleExpand('codex')} className="flex items-center gap-1 w-full px-2 py-1.5 text-zinc-400 hover:bg-zinc-900 font-medium uppercase text-xs mt-2">
                  {expanded.has('codex') ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  Codex (read-only)
                </button>
                {expanded.has('codex') && codexMemories.map(mem => (
                  <div
                    key={mem.threadId}
                    className={`flex items-center gap-1 px-4 py-1 cursor-pointer hover:bg-zinc-800 ${
                      selectedFile?.filename === mem.threadId ? 'bg-zinc-800' : ''
                    }`}
                    onClick={() => selectCodexMemory(mem)}
                  >
                    <FileText size={10} className="text-zinc-600 shrink-0" />
                    <div className="truncate text-zinc-300 text-xs">{mem.rolloutSummary || mem.threadId}</div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Right panel: editor/viewer */}
      <div className="flex-1 flex flex-col">
        {selectedFile ? (
          <>
            <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
              <span className="text-sm text-zinc-400">{selectedFile.filename}</span>
              {selectedFile.provider === 'claude' && (
                <button
                  onClick={handleSave}
                  disabled={!hasChanges}
                  className={`flex items-center gap-1 px-3 py-1 text-sm rounded ${
                    hasChanges
                      ? 'bg-blue-600 hover:bg-blue-500 text-white'
                      : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                  }`}
                >
                  <Save size={12} />
                  Save
                </button>
              )}
            </div>
            <textarea
              value={editorContent}
              onChange={e => setEditorContent(e.target.value)}
              readOnly={selectedFile.provider !== 'claude'}
              className="flex-1 p-4 bg-zinc-950 text-zinc-300 font-mono text-sm resize-none focus:outline-none"
              spellCheck={false}
            />
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-600">
            Select a memory file to view
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify Memory page works**

Run: Check http://localhost:5173/memory — projects and memory files should be listed, clicking opens editor.

- [ ] **Step 3: Commit**

```bash
git add src/client/pages/Memory.tsx
git commit -m "feat: implement Memory page with file tree, editor, and CRUD operations"
```

---

### Task 15: Usage Page with Visibility Polling

**Files:**
- Create: `src/client/hooks/useVisibilityPolling.ts`
- Create: `src/client/pages/Usage.tsx`

- [ ] **Step 1: Implement visibility-driven polling hook**

```typescript
// src/client/hooks/useVisibilityPolling.ts
import { useEffect, useRef, useCallback } from 'react';

export function useVisibilityPolling(
  fetchFn: () => Promise<void>,
  intervalMs: number = 60_000,
  enabled: boolean = true,
) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    // Immediate fetch
    if (isMountedRef.current) fetchFn();
    // Set up interval
    timerRef.current = setInterval(() => {
      if (isMountedRef.current) fetchFn();
    }, intervalMs);
  }, [fetchFn, intervalMs, stopPolling]);

  useEffect(() => {
    isMountedRef.current = true;

    if (!enabled) {
      stopPolling();
      return;
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        startPolling();
      } else {
        stopPolling();
      }
    };

    // Start immediately if page is visible
    if (document.visibilityState === 'visible') {
      startPolling();
    }

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      isMountedRef.current = false;
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled, startPolling, stopPolling]);
}
```

- [ ] **Step 2: Implement Usage page**

```tsx
// src/client/pages/Usage.tsx
import { useState, useCallback } from 'react';
import { useVisibilityPolling } from '../hooks/useVisibilityPolling';
import { api } from '../lib/api';
import { RefreshCw, AlertTriangle } from 'lucide-react';

interface UsageTier {
  name: string;
  label: string;
  utilization: number;
  resetAt: number;
}

interface ProviderUsage {
  provider: string;
  tiers: UsageTier[];
  error?: string;
  tokenExpired?: boolean;
}

function getBarColor(utilization: number): string {
  if (utilization >= 0.9) return 'bg-red-500';
  if (utilization >= 0.7) return 'bg-amber-500';
  return 'bg-green-500';
}

function formatCountdown(resetAt: number): string {
  const diff = resetAt - Date.now();
  if (diff <= 0) return 'Resetting...';
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function UsageCard({ usage }: { usage: ProviderUsage }) {
  const providerLabel = usage.provider === 'claude' ? 'Claude Code' : 'Codex';

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <h3 className="text-sm font-medium text-zinc-300 mb-3">{providerLabel}</h3>

      {usage.tokenExpired && (
        <div className="flex items-center gap-2 text-amber-400 text-xs mb-3">
          <AlertTriangle size={14} />
          <span>OAuth token expired — re-login to {providerLabel} to refresh</span>
        </div>
      )}

      {usage.error && !usage.tokenExpired && (
        <div className="text-red-400 text-xs mb-3">Error: {usage.error}</div>
      )}

      {usage.tiers.length === 0 && !usage.error && !usage.tokenExpired && (
        <div className="text-zinc-500 text-xs">No usage data available</div>
      )}

      <div className="space-y-3">
        {usage.tiers.map(tier => (
          <div key={tier.name}>
            <div className="flex justify-between text-xs text-zinc-400 mb-1">
              <span>{tier.label}</span>
              <span>{(tier.utilization * 100).toFixed(1)}%</span>
            </div>
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${getBarColor(tier.utilization)}`}
                style={{ width: `${Math.min(tier.utilization * 100, 100)}%` }}
              />
            </div>
            {tier.resetAt > 0 && (
              <div className="text-[10px] text-zinc-600 mt-0.5">
                Resets in {formatCountdown(tier.resetAt)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Usage() {
  const [data, setData] = useState<ProviderUsage[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number>(0);

  const fetchUsage = useCallback(async () => {
    try {
      const result = await api.usage.all();
      setData(result);
      setLastUpdated(Date.now());
    } catch {
      // Will retry on next interval
    }
  }, []);

  useVisibilityPolling(fetchUsage, 60_000);

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-medium text-zinc-200">Usage</h2>
        <div className="flex items-center gap-2">
          {lastUpdated > 0 && (
            <span className="text-xs text-zinc-600">
              Updated {new Date(lastUpdated).toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchUsage}
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            title="Refresh now"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      <div className="space-y-4">
        {data.length === 0 ? (
          <div className="text-zinc-500 text-sm">Loading usage data...</div>
        ) : (
          data.map(usage => <UsageCard key={usage.provider} usage={usage} />)
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify Usage page works**

Run: Check http://localhost:5173/usage — should show usage bars for Claude/Codex with auto-refresh.

- [ ] **Step 4: Commit**

```bash
git add src/client/hooks/useVisibilityPolling.ts src/client/pages/Usage.tsx
git commit -m "feat: implement Usage page with visibility-driven polling"
```

---

### Task 16: Build and npm Packaging

**Files:**
- Modify: `package.json` (verify scripts)
- Verify: `tsup.config.ts`, `vite.config.ts`

- [ ] **Step 1: Run full build**

Run: `npm run build`
Expected: `dist/client/` contains built frontend files (`index.html`, JS/CSS bundles); `dist/server/index.js` and `dist/bin/cc-manage.js` exist.

- [ ] **Step 2: Verify built server works**

Run: `node dist/server/index.js`
Expected: Server starts on port 3456, serves the built frontend, API endpoints work.

- [ ] **Step 3: Verify CLI works**

Run: `node dist/bin/cc-manage.js start --port 3457` then `node dist/bin/cc-manage.js status` then `node dist/bin/cc-manage.js stop`
Expected: Server starts, status reports running, stop shuts it down.

- [ ] **Step 4: Test npm link**

Run: `npm link` then `cc-manage start` then `cc-manage status` then `cc-manage stop`
Expected: CLI is globally available, server starts and stops correctly.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: verify build, CLI, and npm packaging"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** Sessions (list/view/delete/rename/batch-delete), Memory (Claude CRUD + Codex read-only), Usage (visibility-driven polling), Web UI (3 pages), CLI (start/stop/status), npm packaging — all covered.
- [x] **Placeholder scan:** No TBD/TODO/placeholders found.
- [x] **Type consistency:** `SessionMeta`, `SessionMessage`, `ProviderGroup`, `ProviderUsage`, `UsageTier`, `MemoryFileMeta`, `MemoryFileContent`, `MemoryProject`, `CodexMemoryEntry` — consistent across all tasks.
- [x] **Function names consistent:** `readHeadTail`, `extractClaudeSessionMeta`, `extractCodexSessionMeta`, `parseClaudeMessages`, `parseCodexMessages`, `discoverClaudeSessions`, `discoverCodexSessions`, `deleteClaudeSession`, `deleteCodexSession`, `renameClaudeSession`, `listMemoryProjects`, `listMemories`, `readMemory`, `createMemory`, `updateMemory`, `deleteMemory`, `listCodexMemories`, `fetchClaudeUsage`, `fetchCodexUsage`, `fetchAllUsage` — all match between definition and usage.
