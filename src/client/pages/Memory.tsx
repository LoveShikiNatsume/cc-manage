import { useEffect, useState, useCallback } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Trash2,
  Save,
  FileText,
  Database,
  Eye,
  Pencil,
  RefreshCw,
} from 'lucide-react';
import type { MemoryProject, MemoryFileContent, CodexMemoryEntry } from '@shared/types';
import MarkdownView from '../components/MarkdownView';
import {
  getClaudeMemory,
  getClaudeMemoryFile,
  createClaudeMemoryFile,
  updateClaudeMemoryFile,
  deleteClaudeMemoryFile,
  rebuildClaudeMemoryIndex,
  getCodexMemory,
} from '../lib/api';

interface CreateForm {
  project: string;
  filename: string;
  name: string;
  description: string;
  type: string;
  body: string;
}

const MEMORY_TYPES = ['agent', 'tool', 'context', 'knowledge', 'other'];

function formatDate(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function markdownBody(raw: string): string {
  if (!raw.startsWith('---')) return raw;
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return raw;
  const after = raw.indexOf('\n', end + 4);
  return after === -1 ? '' : raw.slice(after + 1);
}

export default function Memory() {
  const [claudeProjects, setClaudeProjects] = useState<MemoryProject[]>([]);
  const [codexEntries, setCodexEntries] = useState<CodexMemoryEntry[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<{
    project: string;
    filename: string;
  } | null>(null);
  const [fileContent, setFileContent] = useState<MemoryFileContent | null>(null);
  const [editedContent, setEditedContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm | null>(null);
  const [selectedCodex, setSelectedCodex] = useState<CodexMemoryEntry | null>(null);
  const [hoveredFile, setHoveredFile] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'claude' | 'codex'>('claude');
  const [viewMode, setViewMode] = useState<'preview' | 'edit'>('preview');

  const loadClaude = useCallback(async () => {
    try {
      const data = await getClaudeMemory();
      setClaudeProjects(data);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadCodex = useCallback(async () => {
    try {
      const data = await getCodexMemory();
      setCodexEntries(data);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadClaude();
    loadCodex();
  }, [loadClaude, loadCodex]);

  const toggleCollapse = (key: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const openFile = async (project: string, filename: string) => {
    setSelectedCodex(null);
    setSelectedFile({ project, filename });
    setFileContent(null);
    setEditedContent('');
    setViewMode('preview');
    try {
      const data = await getClaudeMemoryFile(project, filename);
      setFileContent(data);
      setEditedContent(data.rawContent);
    } catch (e) {
      console.error(e);
    }
  };

  const saveFile = async () => {
    if (!selectedFile || !fileContent) return;
    setSaving(true);
    try {
      await updateClaudeMemoryFile(selectedFile.project, selectedFile.filename, editedContent);
      await loadClaude();
      const data = await getClaudeMemoryFile(selectedFile.project, selectedFile.filename);
      setFileContent(data);
      setEditedContent(data.rawContent);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const deleteFile = async (e: React.MouseEvent, project: string, filename: string) => {
    e.stopPropagation();
    if (!confirm(`Delete "${filename}"?`)) return;
    try {
      await deleteClaudeMemoryFile(project, filename);
      if (selectedFile?.project === project && selectedFile?.filename === filename) {
        setSelectedFile(null);
        setFileContent(null);
        setEditedContent('');
      }
      await loadClaude();
    } catch (e) {
      console.error(e);
    }
  };

  const submitCreate = async () => {
    if (!createForm) return;
    const { project, ...payload } = createForm;
    if (!payload.filename.trim()) return;
    try {
      await createClaudeMemoryFile(project, payload);
      setCreateForm(null);
      await loadClaude();
      await openFile(project, payload.filename);
    } catch (e) {
      console.error(e);
    }
  };

  const rebuildIndex = async (e: React.MouseEvent, project: string) => {
    e.stopPropagation();
    try {
      await rebuildClaudeMemoryIndex(project);
      await loadClaude();
      if (selectedFile?.project === project && selectedFile.filename === 'MEMORY.md') {
        await openFile(project, 'MEMORY.md');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const isDirty = fileContent !== null && editedContent !== fileContent.rawContent;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel */}
      <div className="w-72 shrink-0 flex flex-col bg-white border-r border-gray-200 overflow-hidden">
        <div className="flex-1 overflow-y-auto py-1">
          {/* Claude section */}
          <div>
            <button
              onClick={() => toggleCollapse('__claude__')}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors"
            >
              {collapsed.has('__claude__') ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              <FileText size={13} />
              Claude Code
            </button>

            {!collapsed.has('__claude__') && claudeProjects.map(proj => {
              const projKey = `c:${proj.project}`;
              const isProjCollapsed = collapsed.has(projKey);
              return (
                <div key={proj.project}>
                  <div className="flex items-center pl-5 pr-2 py-1 group">
                    <button
                      onClick={() => toggleCollapse(projKey)}
                      className="flex-1 flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 transition-colors min-w-0"
                    >
                      {isProjCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                      <span className="truncate">{proj.project || '(global)'}</span>
                    </button>
                    <button
                      onClick={e => rebuildIndex(e, proj.project)}
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-900 transition-all p-0.5"
                      title="Rebuild MEMORY.md"
                    >
                      <RefreshCw size={13} />
                    </button>
                    <button
                      onClick={() => {
                        setCreateForm({
                          project: proj.project,
                          filename: '',
                          name: '',
                          description: '',
                          type: 'agent',
                          body: '',
                        });
                        setSelectedCodex(null);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-900 transition-all p-0.5"
                      title="New memory file"
                    >
                      <Plus size={13} />
                    </button>
                  </div>

                  {!isProjCollapsed && (
                    <>
                      {proj.memories.map(mem => {
                        const fileKey = `${proj.project}:${mem.filename}`;
                        const isActive =
                          selectedFile?.project === proj.project &&
                          selectedFile?.filename === mem.filename;
                        return (
                          <div
                            key={mem.filename}
                            onClick={() => openFile(proj.project, mem.filename)}
                            onMouseEnter={() => setHoveredFile(fileKey)}
                            onMouseLeave={() => setHoveredFile(null)}
                            className={`flex items-center pl-9 pr-2 py-1 cursor-pointer transition-colors group ${
                              isActive
                                ? 'bg-blue-50 text-blue-700'
                                : 'text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            <span className="flex-1 text-xs truncate">{mem.filename}</span>
                            {hoveredFile === fileKey && mem.filename !== 'MEMORY.md' && (
                              <button
                                onClick={e => deleteFile(e, proj.project, mem.filename)}
                                className="text-gray-400 hover:text-red-500 transition-colors p-0.5"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        );
                      })}

                      {/* Inline create form */}
                      {createForm?.project === proj.project && (
                        <div className="mx-3 mb-2 p-2 bg-gray-50 rounded-md border border-gray-200 space-y-1.5">
                          <input
                            autoFocus
                            placeholder="filename.md"
                            value={createForm.filename}
                            onChange={e => setCreateForm(f => f ? { ...f, filename: e.target.value } : f)}
                            className="w-full bg-white text-gray-900 text-xs rounded px-2 py-1 outline-none border border-gray-200 focus:border-blue-400 focus:ring-1 focus:ring-blue-200 placeholder:text-gray-400"
                          />
                          <input
                            placeholder="Name"
                            value={createForm.name}
                            onChange={e => setCreateForm(f => f ? { ...f, name: e.target.value } : f)}
                            className="w-full bg-white text-gray-900 text-xs rounded px-2 py-1 outline-none border border-gray-200 focus:border-blue-400 focus:ring-1 focus:ring-blue-200 placeholder:text-gray-400"
                          />
                          <input
                            placeholder="Description"
                            value={createForm.description}
                            onChange={e => setCreateForm(f => f ? { ...f, description: e.target.value } : f)}
                            className="w-full bg-white text-gray-900 text-xs rounded px-2 py-1 outline-none border border-gray-200 focus:border-blue-400 focus:ring-1 focus:ring-blue-200 placeholder:text-gray-400"
                          />
                          <select
                            value={createForm.type}
                            onChange={e => setCreateForm(f => f ? { ...f, type: e.target.value } : f)}
                            className="w-full bg-white text-gray-900 text-xs rounded px-2 py-1 outline-none border border-gray-200 focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
                          >
                            {MEMORY_TYPES.map(t => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                          <textarea
                            placeholder="Content…"
                            value={createForm.body}
                            onChange={e => setCreateForm(f => f ? { ...f, body: e.target.value } : f)}
                            rows={3}
                            className="w-full bg-white text-gray-900 text-xs rounded px-2 py-1 outline-none border border-gray-200 focus:border-blue-400 focus:ring-1 focus:ring-blue-200 placeholder:text-gray-400 resize-none"
                          />
                          <div className="flex gap-1.5">
                            <button
                              onClick={submitCreate}
                              className="flex-1 text-xs py-1 rounded bg-blue-500 hover:bg-blue-600 text-white transition-colors"
                            >
                              Create
                            </button>
                            <button
                              onClick={() => setCreateForm(null)}
                              className="flex-1 text-xs py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}

            {claudeProjects.length === 0 && !collapsed.has('__claude__') && (
              <p className="pl-8 py-2 text-xs text-gray-400">No memory files</p>
            )}
          </div>

          {/* Codex section */}
          <div className="mt-2 border-t border-gray-200 pt-1">
            <button
              onClick={() => toggleCollapse('__codex__')}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors"
            >
              {collapsed.has('__codex__') ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              <Database size={13} />
              Codex
              <span className="ml-1 text-gray-400 text-xs">(read-only)</span>
            </button>

            {!collapsed.has('__codex__') && codexEntries.map(entry => (
              <div
                key={entry.threadId}
                onClick={() => { setSelectedCodex(entry); setSelectedFile(null); setFileContent(null); setEditedContent(''); setActiveSection('codex'); }}
                className={`pl-7 pr-3 py-1.5 cursor-pointer transition-colors ${
                  selectedCodex?.threadId === entry.threadId
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <p className="text-xs truncate">{entry.rolloutSlug || entry.threadId}</p>
                <p className="text-xs text-gray-400">{formatDate(entry.generatedAt)}</p>
              </div>
            ))}

            {codexEntries.length === 0 && !collapsed.has('__codex__') && (
              <p className="pl-8 py-2 text-xs text-gray-400">No Codex memory</p>
            )}
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
        {selectedFile && fileContent ? (
          <>
            <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-gray-200 shrink-0 bg-white">
              <div>
                <h2 className="text-sm font-medium text-gray-900">{fileContent.filename}</h2>
                <p className="text-xs text-gray-400">{fileContent.name} · {fileContent.type}</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex rounded-md border border-gray-200 bg-gray-50 p-0.5">
                  <button
                    onClick={() => setViewMode('preview')}
                    className={`flex items-center gap-1 px-2 py-1 text-xs rounded ${
                      viewMode === 'preview'
                        ? 'bg-white text-blue-700 shadow-sm'
                        : 'text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    <Eye size={13} />
                    Preview
                  </button>
                  <button
                    onClick={() => setViewMode('edit')}
                    className={`flex items-center gap-1 px-2 py-1 text-xs rounded ${
                      viewMode === 'edit'
                        ? 'bg-white text-blue-700 shadow-sm'
                        : 'text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    <Pencil size={13} />
                    Edit
                  </button>
                </div>
                <button
                  disabled={!isDirty || saving}
                  onClick={saveFile}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${
                    isDirty && !saving
                      ? 'bg-blue-500 hover:bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  <Save size={14} />
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
            {viewMode === 'edit' ? (
              <textarea
                value={editedContent}
                onChange={e => setEditedContent(e.target.value)}
                spellCheck={false}
                className="flex-1 w-full bg-white text-gray-800 text-sm font-mono px-5 py-4 outline-none resize-none leading-relaxed border-t border-gray-100"
              />
            ) : (
              <div className="flex-1 overflow-y-auto bg-white px-6 py-5 text-sm text-gray-800">
                <MarkdownView content={markdownBody(editedContent)} />
              </div>
            )}
          </>
        ) : selectedFile && !fileContent ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
        ) : selectedCodex ? (
          <>
            <div className="px-5 py-3 border-b border-gray-200 shrink-0 bg-white">
              <h2 className="text-sm font-medium text-gray-900">
                {selectedCodex.rolloutSlug || selectedCodex.threadId}
              </h2>
              <p className="text-xs text-gray-400">{formatDate(selectedCodex.generatedAt)}</p>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {selectedCodex.rolloutSummary && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Summary</p>
                  <MarkdownView content={selectedCodex.rolloutSummary} compact />
                </div>
              )}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Raw Memory</p>
                <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700">
                  <MarkdownView content={selectedCodex.rawMemory} compact />
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            Select a memory file to view or edit
          </div>
        )}
      </div>
    </div>
  );
}
