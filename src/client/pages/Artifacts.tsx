import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Bot,
  ChevronDown,
  ChevronRight,
  Database,
  FileCode,
  FileJson,
  FileText,
  Folder,
  HardDrive,
  History,
  Image,
  RefreshCw,
  Search,
  Settings,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import type {
  ClaudeArtifactContent,
  ClaudeArtifactGroup,
  ClaudeArtifactItem,
  ClaudeArtifactKind,
  ClaudeArtifactsOverview,
} from '@shared/types';
import MarkdownView from '../components/MarkdownView';
import {
  deleteClaudeArtifact,
  getClaudeArtifactContent,
  getClaudeArtifacts,
} from '../lib/api';

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function formatArtifactSize(item: ClaudeArtifactItem): string {
  return item.isDirectory ? 'directory' : formatBytes(item.size);
}

function formatTime(ts: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const kindLabels: Record<ClaudeArtifactKind, string> = {
  'session-backup': 'Session backup',
  'config-backup': 'Config backup',
  subagent: 'Subagent',
  'tool-result': 'Tool result',
  plan: 'Plan',
  job: 'Job',
  'shell-snapshot': 'Shell snapshot',
  'session-env': 'Session env',
  'file-history': 'File history',
  telemetry: 'Telemetry',
  cache: 'Cache',
  config: 'Config',
  log: 'Log',
  'large-storage': 'Large storage',
  'project-file': 'Project file',
  other: 'Other',
};

function ArtifactIcon({ item }: { item: ClaudeArtifactItem }) {
  const size = 14;
  if (item.isDirectory) return <Folder size={size} />;
  if (item.kind === 'session-backup' || item.kind === 'config-backup') return <Archive size={size} />;
  if (item.kind === 'subagent') return <Bot size={size} />;
  if (item.kind === 'tool-result') {
    return item.contentType === 'image' ? <Image size={size} /> : <FileText size={size} />;
  }
  if (item.kind === 'plan') return <FileText size={size} />;
  if (item.kind === 'job' || item.kind === 'telemetry') return <Database size={size} />;
  if (item.kind === 'shell-snapshot') return <Terminal size={size} />;
  if (item.kind === 'file-history') return <History size={size} />;
  if (item.kind === 'config') return <Settings size={size} />;
  if (item.kind === 'large-storage') return <HardDrive size={size} />;
  if (item.contentType === 'json' || item.contentType === 'jsonl') return <FileJson size={size} />;
  if (item.contentType === 'shell') return <FileCode size={size} />;
  return <FileText size={size} />;
}

function renderPreview(content: ClaudeArtifactContent) {
  if (content.contentType === 'directory') {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        Directory summary
      </div>
    );
  }

  if (content.contentType === 'image' && content.encoding === 'base64' && content.content) {
    return (
      <div className="flex h-full items-start justify-center overflow-auto bg-white p-5">
        <img
          src={content.content}
          alt={content.name}
          className="max-h-full max-w-full rounded border border-gray-200 object-contain"
        />
      </div>
    );
  }

  if (content.encoding !== 'utf-8' || content.content === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        Preview unavailable
      </div>
    );
  }

  if (content.contentType === 'markdown') {
    return (
      <div className="h-full overflow-y-auto bg-white px-6 py-5 text-sm text-gray-800">
        <MarkdownView content={content.content} />
      </div>
    );
  }

  return (
    <pre className="h-full overflow-auto bg-white px-5 py-4 font-mono text-xs leading-relaxed text-gray-700 whitespace-pre-wrap break-words">
      {content.content}
    </pre>
  );
}

export default function Artifacts() {
  const [overview, setOverview] = useState<ClaudeArtifactsOverview | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [selectedItem, setSelectedItem] = useState<ClaudeArtifactItem | null>(null);
  const [content, setContent] = useState<ClaudeArtifactContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getClaudeArtifacts();
      setOverview(data);
    } catch (err) {
      console.error(err);
      setNotice(err instanceof Error ? err.message : 'Failed to load artifacts');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openArtifact = async (item: ClaudeArtifactItem) => {
    setSelectedItem(item);
    setContent(null);
    setNotice(null);
    setLoading(true);
    try {
      const result = await getClaudeArtifactContent(item.path);
      setContent(result);
    } catch (err) {
      console.error(err);
      setNotice(err instanceof Error ? err.message : 'Failed to read artifact');
    } finally {
      setLoading(false);
    }
  };

  const deleteArtifact = async (item: ClaudeArtifactItem) => {
    if (!item.deletable) return;
    if (!confirm(`Delete backup "${item.name}"?`)) return;

    try {
      await deleteClaudeArtifact(item.path);
      setNotice(`Deleted ${item.relativePath}`);
      if (selectedItem?.path === item.path) {
        setSelectedItem(null);
        setContent(null);
      }
      await load();
    } catch (err) {
      console.error(err);
      setNotice(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const filteredGroups = useMemo<ClaudeArtifactGroup[]>(() => {
    const groups = overview?.groups ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return groups;

    return groups
      .map(group => ({
        ...group,
        items: group.items.filter(item => {
          const haystack = [
            group.label,
            item.name,
            item.relativePath,
            item.project ?? '',
            item.sessionId ?? '',
            kindLabels[item.kind],
          ].join(' ').toLowerCase();
          return haystack.includes(term);
        }),
      }))
      .filter(group => group.items.length > 0);
  }, [overview?.groups, search]);

  const toggleGroup = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedMeta = content ?? selectedItem;

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex w-96 shrink-0 flex-col overflow-hidden border-r border-gray-200 bg-white">
        <div className="space-y-2 border-b border-gray-200 p-3">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search artifacts…"
              className="w-full rounded-md border border-gray-200 bg-gray-50 py-1.5 pl-8 pr-8 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs text-gray-400">{overview?.configDir ?? '~/.claude'}</p>
            <button
              onClick={load}
              className="flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-900"
            >
              <RefreshCw size={13} />
              Refresh
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {filteredGroups.map(group => {
            const isCollapsed = collapsed.has(group.id);
            return (
              <div key={group.id}>
                <button
                  onClick={() => toggleGroup(group.id)}
                  className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900"
                >
                  {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  <span className="truncate">{group.label}</span>
                  <span className="ml-auto text-gray-400">
                    {group.totalCount}
                    {group.truncated ? '+' : ''}
                  </span>
                </button>
                {!isCollapsed && group.items.map(item => {
                  const active = selectedItem?.path === item.path;
                  return (
                    <div
                      key={item.path}
                      onClick={() => openArtifact(item)}
                      className={`group flex cursor-pointer items-start gap-2 px-3 py-1.5 transition-colors ${
                        active
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <div className="mt-0.5 shrink-0 text-gray-400">
                        <ArtifactIcon item={item} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-xs">{item.name}</span>
                          {item.deletable && (
                            <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                              bak
                            </span>
                          )}
                        </div>
                        <p className="truncate text-xs text-gray-400">
                          {kindLabels[item.kind]} · {formatArtifactSize(item)} · {formatTime(item.mtime)}
                        </p>
                      </div>
                      {item.deletable && (
                        <button
                          onClick={event => {
                            event.stopPropagation();
                            deleteArtifact(item);
                          }}
                          className="shrink-0 p-0.5 text-gray-400 opacity-0 transition-all hover:text-red-500 group-hover:opacity-100"
                          title="Delete backup"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {!overview && (
            <p className="px-4 py-8 text-center text-sm text-gray-400">Loading…</p>
          )}
          {overview && filteredGroups.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-gray-400">No artifacts found</p>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden bg-gray-50">
        {selectedMeta ? (
          <>
            <div className="shrink-0 border-b border-gray-200 bg-white px-5 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-gray-400">
                      <ArtifactIcon item={selectedMeta} />
                    </span>
                    <h2 className="truncate text-sm font-medium text-gray-900">{selectedMeta.name}</h2>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-gray-400">{selectedMeta.relativePath}</p>
                </div>
                {selectedMeta.deletable && (
                  <button
                    onClick={() => deleteArtifact(selectedMeta)}
                    className="flex shrink-0 items-center gap-1.5 rounded bg-red-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-600"
                  >
                    <Trash2 size={13} />
                    Delete backup
                  </button>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span className="rounded bg-gray-100 px-2 py-1">{kindLabels[selectedMeta.kind]}</span>
                <span className="rounded bg-gray-100 px-2 py-1">{formatArtifactSize(selectedMeta)}</span>
                <span className="rounded bg-gray-100 px-2 py-1">{formatTime(selectedMeta.mtime)}</span>
                {selectedMeta.project && (
                  <span className="max-w-xs truncate rounded bg-gray-100 px-2 py-1">
                    {selectedMeta.project}
                  </span>
                )}
                {selectedMeta.sessionId && (
                  <span className="max-w-xs truncate rounded bg-gray-100 px-2 py-1">
                    {selectedMeta.sessionId}
                  </span>
                )}
              </div>
              {notice && (
                <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs text-blue-700">
                  {notice}
                </div>
              )}
              {content?.truncated && (
                <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
                  Preview truncated
                </div>
              )}
            </div>

            <div className="flex-1 overflow-hidden">
              {loading ? (
                <div className="flex h-full items-center justify-center text-sm text-gray-400">
                  Loading…
                </div>
              ) : content ? (
                renderPreview(content)
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-gray-400">
                  Select an artifact
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
            Select an artifact
          </div>
        )}
      </div>
    </div>
  );
}
