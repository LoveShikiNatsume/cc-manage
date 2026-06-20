import { describe, it, expect } from 'vitest';
import {
  isWindowsStylePath,
  projectNameFromCwd,
  projectGroupKey,
  isCodexScratchCwd,
} from '../src/server/services/project-path.js';

describe('projectNameFromCwd', () => {
  it('returns the last segment of a Windows path', () => {
    expect(projectNameFromCwd('C:\\Code\\631')).toBe('631');
    expect(projectNameFromCwd('C:\\Users\\Type\\Documents\\proj')).toBe('proj');
  });

  it('returns the last segment of a POSIX path', () => {
    expect(projectNameFromCwd('/home/user/Code/631')).toBe('631');
  });

  it('tolerates trailing separators and empty input', () => {
    expect(projectNameFromCwd('C:\\Code\\631\\')).toBe('631');
    expect(projectNameFromCwd('/home/user/proj/')).toBe('proj');
    expect(projectNameFromCwd('')).toBe('');
  });
});

describe('projectGroupKey', () => {
  it('groups Windows paths case-insensitively', () => {
    expect(projectGroupKey('C:\\Code\\631')).toBe(projectGroupKey('c:\\code\\631'));
    expect(projectGroupKey('C:\\Code\\631')).toBe('631');
  });

  it('preserves case for POSIX paths (case-sensitive filesystems)', () => {
    expect(projectGroupKey('/home/user/Foo')).toBe('Foo');
    expect(projectGroupKey('/home/user/foo')).toBe('foo');
    expect(projectGroupKey('/home/user/Foo')).not.toBe(projectGroupKey('/home/user/foo'));
  });
});

describe('isWindowsStylePath', () => {
  it('detects drive-letter and UNC paths', () => {
    expect(isWindowsStylePath('C:\\Code\\631')).toBe(true);
    expect(isWindowsStylePath('c:/code/631')).toBe(true);
    expect(isWindowsStylePath('\\\\server\\share\\x')).toBe(true);
    expect(isWindowsStylePath('/home/user/proj')).toBe(false);
  });
});

describe('isCodexScratchCwd', () => {
  it('detects Codex Desktop scratch workspaces', () => {
    expect(
      isCodexScratchCwd('C:\\Users\\Type\\Documents\\Codex\\2026-05-05\\codex-desktop-app-git-windows'),
    ).toBe(true);
    expect(isCodexScratchCwd('/home/user/Documents/Codex/2026-06-18/some-slug')).toBe(true);
  });

  it('does not flag real project directories', () => {
    expect(isCodexScratchCwd('C:\\Code\\631')).toBe(false);
    expect(isCodexScratchCwd('/home/user/Code/cc-manage')).toBe(false);
    // A "Codex" folder without a date segment is a real project, not scratch.
    expect(isCodexScratchCwd('C:\\Users\\Type\\Documents\\Codex\\my-real-project')).toBe(false);
  });
});
