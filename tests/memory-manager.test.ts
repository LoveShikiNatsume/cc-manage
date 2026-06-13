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
let configDir: string;
let projectsDir: string;
let projectDir: string;
let memoryDir: string;

const SAMPLE_MD = `---
name: user-role
description: User is a backend engineer
metadata:
  type: user
---

User prefers Go and Python.
`;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-manager-test-'));
  configDir = tmpDir;
  projectsDir = path.join(configDir, 'projects');
  projectDir = path.join(projectsDir, 'myproject');
  memoryDir = path.join(projectDir, 'memory');
  await fs.mkdir(memoryDir, { recursive: true });

  // Create sample memory file
  await fs.writeFile(path.join(memoryDir, 'user-role.md'), SAMPLE_MD, 'utf-8');

  // Create a MEMORY.md index
  await fs.writeFile(
    path.join(memoryDir, 'MEMORY.md'),
    '- user-role.md: User is a backend engineer\n',
    'utf-8',
  );
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('listMemoryProjects', () => {
  it('returns projects that have a memory directory', async () => {
    const projects = await listMemoryProjects(configDir);
    expect(projects.length).toBe(1);
    expect(projects[0].project).toBe('myproject');
    expect(projects[0].projectDir).toBe(projectDir);
    expect(projects[0].memories.length).toBe(1);
    expect(projects[0].memories[0].filename).toBe('user-role.md');
  });

  it('returns empty array when projects directory does not exist', async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-empty-'));
    try {
      const projects = await listMemoryProjects(emptyDir);
      expect(projects).toEqual([]);
    } finally {
      await fs.rm(emptyDir, { recursive: true, force: true });
    }
  });

  it('skips projects without a memory directory', async () => {
    // Create a project without memory dir
    await fs.mkdir(path.join(projectsDir, 'no-memory-project'), { recursive: true });
    const projects = await listMemoryProjects(configDir);
    expect(projects.length).toBe(1);
    expect(projects[0].project).toBe('myproject');
  });

  it('does not include MEMORY.md in the memory list', async () => {
    const projects = await listMemoryProjects(configDir);
    const filenames = projects[0].memories.map(m => m.filename);
    expect(filenames).not.toContain('MEMORY.md');
  });
});

describe('listMemories', () => {
  it('lists .md files in the memory dir, skipping MEMORY.md', async () => {
    const memories = await listMemories(memoryDir, configDir);
    expect(memories.length).toBe(1);
    expect(memories[0].filename).toBe('user-role.md');
    expect(memories[0].name).toBe('user-role');
    expect(memories[0].description).toBe('User is a backend engineer');
    expect(memories[0].type).toBe('user');
  });

  it('returns empty array when memory dir is empty (only MEMORY.md)', async () => {
    const emptyMemDir = path.join(projectsDir, 'emptyproj', 'memory');
    await fs.mkdir(emptyMemDir, { recursive: true });
    await fs.writeFile(path.join(emptyMemDir, 'MEMORY.md'), '', 'utf-8');
    const memories = await listMemories(emptyMemDir, configDir);
    expect(memories).toEqual([]);
  });

  it('rejects paths outside config dir', async () => {
    await expect(listMemories('/tmp/evil', configDir)).rejects.toThrow();
  });
});

describe('readMemory', () => {
  it('reads a memory file and parses frontmatter', async () => {
    const filePath = path.join(memoryDir, 'user-role.md');
    const result = await readMemory(filePath, configDir);
    expect(result.filename).toBe('user-role.md');
    expect(result.name).toBe('user-role');
    expect(result.description).toBe('User is a backend engineer');
    expect(result.type).toBe('user');
    expect(result.body.trim()).toBe('User prefers Go and Python.');
    expect(result.rawContent).toBe(SAMPLE_MD);
  });

  it('rejects paths outside config dir', async () => {
    await expect(readMemory('/tmp/evil.md', configDir)).rejects.toThrow();
  });
});

describe('createMemory', () => {
  it('creates a new memory file with frontmatter', async () => {
    await createMemory(
      memoryDir,
      'tech-stack.md',
      { name: 'tech-stack', description: 'Tech stack preference', type: 'preference' },
      'Uses TypeScript and React.',
      configDir,
    );

    const filePath = path.join(memoryDir, 'tech-stack.md');
    const raw = await fs.readFile(filePath, 'utf-8');
    expect(raw).toContain('name: tech-stack');
    expect(raw).toContain('description: Tech stack preference');
    expect(raw).toContain('Uses TypeScript and React.');
  });

  it('updates MEMORY.md index after creating a new memory', async () => {
    await createMemory(
      memoryDir,
      'tech-stack.md',
      { name: 'tech-stack', description: 'Tech stack preference', type: 'preference' },
      'Uses TypeScript and React.',
      configDir,
    );

    const indexContent = await fs.readFile(path.join(memoryDir, 'MEMORY.md'), 'utf-8');
    expect(indexContent).toContain('tech-stack.md');
    expect(indexContent).toContain('Tech stack preference');
  });

  it('rejects paths outside config dir', async () => {
    await expect(
      createMemory(
        '/tmp/evil',
        'x.md',
        { name: 'x', description: 'x', type: 'x' },
        'body',
        configDir,
      ),
    ).rejects.toThrow();
  });
});

describe('updateMemory', () => {
  it('overwrites a memory file with new content', async () => {
    const filePath = path.join(memoryDir, 'user-role.md');
    const newContent = `---
name: user-role
description: Updated description
metadata:
  type: user
---

User prefers Rust now.
`;
    await updateMemory(filePath, newContent, configDir);

    const read = await fs.readFile(filePath, 'utf-8');
    expect(read).toBe(newContent);
  });

  it('rejects paths outside config dir', async () => {
    await expect(updateMemory('/tmp/evil.md', 'content', configDir)).rejects.toThrow();
  });
});

describe('deleteMemory', () => {
  it('deletes the memory file', async () => {
    const filePath = path.join(memoryDir, 'user-role.md');
    await deleteMemory(filePath, memoryDir, configDir);
    await expect(fs.access(filePath)).rejects.toThrow();
  });

  it('removes entry from MEMORY.md after deletion', async () => {
    const filePath = path.join(memoryDir, 'user-role.md');
    await deleteMemory(filePath, memoryDir, configDir);

    const indexContent = await fs.readFile(path.join(memoryDir, 'MEMORY.md'), 'utf-8');
    expect(indexContent).not.toContain('user-role.md');
  });

  it('rejects file paths outside config dir', async () => {
    await expect(deleteMemory('/tmp/evil.md', memoryDir, configDir)).rejects.toThrow();
  });
});
