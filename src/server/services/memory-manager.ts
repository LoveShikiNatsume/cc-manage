import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import matter from 'gray-matter';
import type { MemoryFileMeta, MemoryFileContent, MemoryProject } from '@shared/types.js';

export function getClaudeConfigDir(): string {
  return path.join(os.homedir(), '.claude');
}

async function validatePath(filePath: string, configDir?: string): Promise<void> {
  const baseDir = configDir ?? getClaudeConfigDir();
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) {
    throw new Error(
      `Path "${filePath}" is outside the Claude config directory "${baseDir}"`,
    );
  }
}

function parseMeta(filePath: string, data: Record<string, unknown>): MemoryFileMeta {
  const filename = path.basename(filePath);
  const metadata = data.metadata as Record<string, unknown> | undefined;
  return {
    filename,
    name: typeof data.name === 'string' ? data.name : filename.replace(/\.md$/, ''),
    description: typeof data.description === 'string' ? data.description : '',
    type: typeof metadata?.type === 'string' ? metadata.type : '',
  };
}

export async function listMemoryProjects(configDir?: string): Promise<MemoryProject[]> {
  const baseDir = configDir ?? getClaudeConfigDir();
  const projectsDir = path.join(baseDir, 'projects');

  try {
    await fs.access(projectsDir);
  } catch {
    return [];
  }

  let projectEntries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    projectEntries = await fs.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: MemoryProject[] = [];

  for (const entry of projectEntries) {
    if (!entry.isDirectory()) continue;
    const projectDir = path.join(projectsDir, entry.name);
    const memDir = path.join(projectDir, 'memory');

    try {
      await fs.access(memDir);
    } catch {
      continue;
    }

    const memories = await listMemories(memDir, baseDir);
    results.push({
      project: entry.name,
      projectDir,
      memories,
    });
  }

  return results;
}

export async function listMemories(
  memoryDir: string,
  configDir?: string,
): Promise<MemoryFileMeta[]> {
  await validatePath(memoryDir, configDir);

  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(memoryDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: MemoryFileMeta[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.md')) continue;
    if (entry.name === 'MEMORY.md') continue;

    const filePath = path.join(memoryDir, entry.name);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = matter(raw);
      results.push(parseMeta(filePath, parsed.data));
    } catch {
      // Include file with defaults if parsing fails
      results.push({
        filename: entry.name,
        name: entry.name.replace(/\.md$/, ''),
        description: '',
        type: '',
      });
    }
  }

  return results;
}

export async function readMemory(
  filePath: string,
  configDir?: string,
): Promise<MemoryFileContent> {
  await validatePath(filePath, configDir);

  const rawContent = await fs.readFile(filePath, 'utf-8');
  const parsed = matter(rawContent);
  const meta = parseMeta(filePath, parsed.data);

  return {
    ...meta,
    body: parsed.content,
    rawContent,
  };
}

export async function createMemory(
  memoryDir: string,
  filename: string,
  meta: Omit<MemoryFileMeta, 'filename'>,
  body: string,
  configDir?: string,
): Promise<void> {
  await validatePath(memoryDir, configDir);

  const filePath = path.join(memoryDir, filename);

  const frontmatter = [
    '---',
    `name: ${meta.name}`,
    `description: ${meta.description}`,
    'metadata:',
    `  type: ${meta.type}`,
    '---',
    '',
    body,
  ].join('\n');

  await fs.writeFile(filePath, frontmatter, 'utf-8');
  await updateMemoryIndex(memoryDir, filename, meta.description, 'add');
}

export async function updateMemory(
  filePath: string,
  rawContent: string,
  configDir?: string,
): Promise<void> {
  await validatePath(filePath, configDir);
  await fs.writeFile(filePath, rawContent, 'utf-8');
}

export async function deleteMemory(
  filePath: string,
  memoryDir: string,
  configDir?: string,
): Promise<void> {
  await validatePath(filePath, configDir);

  const filename = path.basename(filePath);
  await fs.unlink(filePath);
  await updateMemoryIndex(memoryDir, filename, '', 'remove');
}

async function updateMemoryIndex(
  memoryDir: string,
  filename: string,
  description: string,
  action: 'add' | 'remove',
): Promise<void> {
  const indexPath = path.join(memoryDir, 'MEMORY.md');

  let current = '';
  try {
    current = await fs.readFile(indexPath, 'utf-8');
  } catch {
    current = '';
  }

  const lines = current.split('\n');

  // Remove existing entry for this file (in case of add or remove)
  const filtered = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    return !trimmed.startsWith(`- ${filename}:`);
  });

  if (action === 'add') {
    filtered.push(`- ${filename}: ${description}`);
  }

  // Remove trailing empty lines, then add a final newline
  const content = filtered.join('\n').replace(/\n+$/, '') + '\n';
  await fs.writeFile(indexPath, content, 'utf-8');
}
