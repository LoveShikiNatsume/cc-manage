import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Trash2,
  Search,
  X,
  CheckSquare,
  Square,
  Wrench,
  RefreshCw,
  AlertTriangle,
  Archive,
  PanelRightOpen,
} from 'lucide-react';
import type { ClaudeRepairIssue, ProviderGroup, SessionMeta, SessionMessage } from '@shared/types';
import MarkdownView from '../components/MarkdownView';
import SessionArtifactsPanel from '../components/SessionArtifactsPanel';
import {
  getSessions,
  getMessages,
  getSessionArtifacts,
  deleteSession,
  batchDeleteSessions,
  renameSession,
  scanClaudeRepairs,
  repairSession,
  repairAllClaudeSessions,
  deleteSessionMessages,
} from '../lib/api';

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMsgTime(ts: number) {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface RenameState {
  id: string;
  provider: string;
  value: string;
}

export default function Sessions() {
  const [groups, setGroups] = useState<ProviderGroup[]>([]);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedSession, setSelectedSession] = useState<SessionMeta | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<RenameState | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [repairIssues, setRepairIssues] = useState<ClaudeRepairIssue[]>([]);
  const [repairBusy, setRepairBusy] = useState(false);
  const [messageSelectMode, setMessageSelectMode] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set());
  const [mutationNotice, setMutationNotice] = useState<string | null>(null);
  const [createBackups, setCreateBackups] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [resourceCount, setResourceCount] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);
  const msgEndRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await getSessions();
      setGroups(data);
      return data;
    } catch (e) {
      console.error(e);
      return null;
    }
  }, []);

  const scanRepairs = useCallback(async () => {
    try {
      const issues = await scanClaudeRepairs();
      setRepairIssues(issues);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    load();
    scanRepairs();
  }, [load, scanRepairs]);

  useEffect(() => {
    if (renaming) renameRef.current?.focus();
  }, [renaming]);

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const openSession = async (session: SessionMeta, opts: { preserveNotice?: boolean } = {}) => {
    if (selectMode) return;
    setSelectedSession(session);
    setMessages([]);
    setSelectedMessages(new Set());
    setMessageSelectMode(false);
    setResourceCount(null);
    if (!opts.preserveNotice) setMutationNotice(null);
    setLoadingMsgs(true);
    const [messageResult, artifactResult] = await Promise.allSettled([
      getMessages(session.provider, session.id),
      session.provider === 'claude'
        ? getSessionArtifacts(session.provider, session.id)
        : Promise.resolve(null),
    ]);
    if (messageResult.status === 'fulfilled') {
      setMessages(messageResult.value);
    } else {
      console.error(messageResult.reason);
    }
    if (artifactResult.status === 'fulfilled' && artifactResult.value) {
      setResourceCount(artifactResult.value.totalCount);
    } else if (artifactResult.status === 'rejected') {
      console.error(artifactResult.reason);
    }
    setLoadingMsgs(false);
  };

  const findSession = (data: ProviderGroup[], provider: string, id: string) => {
    for (const group of data) {
      if (group.provider !== provider) continue;
      for (const project of group.projects) {
        const found = project.sessions.find(session => session.id === id);
        if (found) return found;
      }
    }
    return null;
  };

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      const data = await load();
      await scanRepairs();
      if (!selectedSession || !data) return;
      const freshSession = findSession(data, selectedSession.provider, selectedSession.id);
      if (!freshSession) {
        setSelectedSession(null);
        setMessages([]);
        setSelectedMessages(new Set());
        setMessageSelectMode(false);
        setResourceCount(null);
        setMutationNotice('Selected session no longer exists.');
        return;
      }
      await openSession(freshSession, { preserveNotice: true });
    } finally {
      setRefreshing(false);
    }
  };

  const toggleCollapse = (key: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelect = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleMessageSelect = (id: string) => {
    setSelectedMessages(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = async (e: React.MouseEvent, session: SessionMeta) => {
    e.stopPropagation();
    if (!confirm(`Delete "${session.title}"?`)) return;
    try {
      await deleteSession(session.provider, session.id);
      if (selectedSession?.id === session.id) {
        setSelectedSession(null);
        setMessages([]);
      }
      await load();
    } catch (e) {
      console.error(e);
    }
  };

  const handleBatchDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} session(s)?`)) return;
    const ids = [...selected].map(key => {
      const [provider, ...rest] = key.split(':');
      return { provider, id: rest.join(':') };
    });
    try {
      await batchDeleteSessions(ids);
      setSelected(new Set());
      setSelectMode(false);
      if (selectedSession && ids.some(i => i.id === selectedSession.id)) {
        setSelectedSession(null);
        setMessages([]);
      }
      await load();
    } catch (e) {
      console.error(e);
    }
  };

  const startRename = (e: React.MouseEvent, session: SessionMeta) => {
    e.stopPropagation();
    setRenaming({ id: session.id, provider: session.provider, value: session.title });
  };

  const commitRename = async () => {
    if (!renaming) return;
    const trimmed = renaming.value.trim();
    if (trimmed) {
      try {
        await renameSession(renaming.provider, renaming.id, trimmed);
        await load();
      } catch (e) {
        console.error(e);
      }
    }
    setRenaming(null);
  };

  const handleRepairSelected = async () => {
    if (!selectedSession || selectedSession.provider !== 'claude') return;
    setRepairBusy(true);
    try {
      const result = await repairSession(selectedSession.provider, selectedSession.id, createBackups);
      if (!result.ok) {
        setMutationNotice(result.error ?? 'Automatic repair was refused.');
        return;
      }
      const notice = `Repair complete. Backup: ${
        result.backupPath ?? (createBackups ? 'none' : 'disabled')
      }; inserted ${result.inserted}, dropped orphan results ${result.droppedOrphans}.`;
      await scanRepairs();
      await load();
      await openSession(selectedSession, { preserveNotice: true });
      setMutationNotice(notice);
    } catch (e) {
      console.error(e);
    } finally {
      setRepairBusy(false);
    }
  };

  const handleRepairAll = async () => {
    const repairableCount = repairIssues.filter(issue => issue.repairable).length;
    if (repairableCount === 0) return;
    if (
      !confirm(
        `Repair ${repairableCount} automatically repairable Claude session(s)? ${
          createBackups ? 'Backups will be created.' : 'Backups are disabled.'
        }`,
      )
    ) return;
    setRepairBusy(true);
    try {
      const { results } = await repairAllClaudeSessions(createBackups);
      const ok = results.filter(r => r.ok).length;
      const backups = results.map(r => r.backupPath).filter(Boolean);
      const notice = `Repair complete: ${ok}/${results.length} session(s). ${
        backups.length > 0
          ? `Latest backup: ${backups[0]}`
          : createBackups
          ? 'No backup path returned.'
          : 'Backups disabled.'
      }`;
      await scanRepairs();
      await load();
      if (selectedSession) await openSession(selectedSession, { preserveNotice: true });
      setMutationNotice(notice);
    } catch (e) {
      console.error(e);
    } finally {
      setRepairBusy(false);
    }
  };

  const handleDeleteMessages = async () => {
    if (!selectedSession || selectedSession.provider !== 'claude' || selectedMessages.size === 0) {
      return;
    }

    if (
      !confirm(
        `Delete ${selectedMessages.size} selected message(s)? ${
          createBackups ? 'A JSONL backup will be created first.' : 'Backups are disabled.'
        }`,
      )
    ) {
      return;
    }

    setRepairBusy(true);
    try {
      const result = await deleteSessionMessages(
        selectedSession.provider,
        selectedSession.id,
        [...selectedMessages],
        createBackups,
      );
      const notice = `Deleted ${result.deletedCount} message(s). Backup: ${
        result.backupPath ?? (createBackups ? 'none' : 'disabled')
      }; repair inserted ${result.repair.inserted}, dropped orphan results ${result.repair.droppedOrphans}.`;
      setSelectedMessages(new Set());
      setMessageSelectMode(false);
      await scanRepairs();
      await load();
      await openSession(selectedSession, { preserveNotice: true });
      setMutationNotice(notice);
    } catch (e) {
      console.error(e);
      setMutationNotice(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setRepairBusy(false);
    }
  };

  // Filter sessions
  const filteredGroups: ProviderGroup[] = search
    ? groups.map(g => ({
        ...g,
        projects: g.projects.map(p => ({
          ...p,
          sessions: p.sessions.filter(s =>
            s.title.toLowerCase().includes(search.toLowerCase())
          ),
        })).filter(p => p.sessions.length > 0),
      })).filter(g => g.projects.length > 0)
    : groups;

  const providerLabel = (p: string) =>
    p === 'claude' ? 'Claude Code' : p === 'codex' ? 'Codex' : p;

  const repairIssueById = useMemo(() => {
    const map = new Map<string, ClaudeRepairIssue>();
    for (const issue of repairIssues) map.set(issue.id, issue);
    return map;
  }, [repairIssues]);

  const selectedRepairIssue = selectedSession
    ? repairIssueById.get(selectedSession.id)
    : undefined;
  const repairableIssueCount = repairIssues.filter(issue => issue.repairable).length;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel */}
      <div className="w-80 shrink-0 flex flex-col bg-white border-r border-gray-200 overflow-hidden">
        {/* Toolbar */}
        <div className="p-3 border-b border-gray-200 space-y-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search sessions…"
              className="w-full bg-gray-50 text-gray-900 text-sm rounded-md pl-8 pr-3 py-1.5 outline-none border border-gray-200 focus:border-blue-400 focus:ring-1 focus:ring-blue-200 placeholder:text-gray-400"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={13} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setSelectMode(m => !m); setSelected(new Set()); }}
              className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors ${selectMode ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}`}
            >
              {selectMode ? <CheckSquare size={13} /> : <Square size={13} />}
              Select
            </button>
            {selectMode && selected.size > 0 && (
              <button
                onClick={handleBatchDelete}
                className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-red-500 hover:bg-red-600 text-white transition-colors"
              >
                <Trash2 size={13} />
                Delete ({selected.size})
              </button>
            )}
            <button
              onClick={refreshAll}
              disabled={repairBusy || refreshing}
              className="flex items-center gap-1.5 text-xs px-2 py-1 rounded text-gray-500 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-50"
              title="Refresh sessions and the current conversation"
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              onClick={() => setCreateBackups(value => !value)}
              className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors ${
                createBackups
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-gray-100 text-gray-500'
              }`}
              title={createBackups ? 'Backups are created before repairs and message edits' : 'Backups are disabled for repairs and message edits'}
            >
              <Archive size={13} />
              {createBackups ? 'Backup' : 'No backup'}
            </button>
            {repairableIssueCount > 0 && (
              <button
                onClick={handleRepairAll}
                disabled={repairBusy}
                className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-amber-500 hover:bg-amber-600 text-white transition-colors disabled:opacity-60"
              >
                <Wrench size={13} />
                Repair ({repairableIssueCount})
              </button>
            )}
          </div>
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto py-1">
          {filteredGroups.map(group => {
            const providerKey = `p:${group.provider}`;
            const isProviderCollapsed = collapsed.has(providerKey);
            return (
              <div key={group.provider}>
                {/* Provider */}
                <button
                  onClick={() => toggleCollapse(providerKey)}
                  className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors"
                >
                  {isProviderCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  {providerLabel(group.provider)}
                </button>

                {!isProviderCollapsed && group.projects.map(project => {
                  const projKey = `proj:${group.provider}:${project.name}`;
                  const isProjCollapsed = collapsed.has(projKey);
                  return (
                    <div key={project.name}>
                      {/* Project */}
                      <button
                        onClick={() => toggleCollapse(projKey)}
                        className="w-full flex items-center gap-1.5 pl-6 pr-3 py-1 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors"
                      >
                        {isProjCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                        <span className="truncate">{project.name || '(root)'}</span>
                        <span className="ml-auto text-gray-400">{project.sessions.length}</span>
                      </button>

                      {!isProjCollapsed && project.sessions.map(session => {
                        const sessionKey = `${session.provider}:${session.id}`;
                        const isSelected = selected.has(sessionKey);
                        const isActive = selectedSession?.id === session.id && !selectMode;
                        return (
                          <div
                            key={session.id}
                            onClick={() => selectMode ? toggleSelect(sessionKey) : openSession(session)}
                            onDoubleClick={e => startRename(e, session)}
                            onMouseEnter={() => setHoveredId(session.id)}
                            onMouseLeave={() => setHoveredId(null)}
                            className={`relative flex items-start gap-2 pl-10 pr-3 py-1.5 cursor-pointer transition-colors group ${
                              isActive
                                ? 'bg-blue-50 text-blue-700'
                                : isSelected
                                ? 'bg-blue-50 text-gray-900'
                                : 'text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            {selectMode && (
                              <div className="mt-0.5 shrink-0 text-gray-400">
                                {isSelected ? <CheckSquare size={13} className="text-blue-500" /> : <Square size={13} />}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              {renaming?.id === session.id ? (
                                <input
                                  ref={renameRef}
                                  value={renaming.value}
                                  onChange={e => setRenaming(r => r ? { ...r, value: e.target.value } : r)}
                                  onBlur={commitRename}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') commitRename();
                                    if (e.key === 'Escape') setRenaming(null);
                                  }}
                                  onClick={e => e.stopPropagation()}
                                  className="w-full bg-white text-gray-900 text-xs rounded px-1 py-0.5 outline-none border border-blue-400 focus:ring-1 focus:ring-blue-200"
                                />
                              ) : (
                              <span className="text-xs truncate block">{session.title}</span>
                              )}
                              <span className="flex items-center gap-1 text-xs text-gray-400">
                                {formatTime(session.lastActivity)}
                                {repairIssueById.has(session.id) && (
                                  <AlertTriangle size={11} className="text-amber-500" />
                                )}
                              </span>
                            </div>
                            {!selectMode && hoveredId === session.id && (
                              <button
                                onClick={e => handleDelete(e, session)}
                                className="shrink-0 p-0.5 text-gray-400 hover:text-red-500 transition-colors"
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
              </div>
            );
          })}
          {filteredGroups.length === 0 && (
            <p className="px-4 py-8 text-sm text-gray-400 text-center">No sessions found</p>
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
        {selectedSession ? (
          <>
            <div className="px-5 py-3 border-b border-gray-200 shrink-0 bg-white">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-medium text-gray-900 truncate">{selectedSession.title}</h2>
                  <p className="text-xs text-gray-400 truncate">{selectedSession.cwd}</p>
                </div>
                {selectedRepairIssue && (
                  <button
                    onClick={handleRepairSelected}
                    disabled={repairBusy || !selectedRepairIssue.repairable}
                    title={selectedRepairIssue.repairBlockedReason}
                    className="shrink-0 flex items-center gap-1.5 rounded bg-amber-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-60"
                  >
                    <Wrench size={13} />
                    {selectedRepairIssue.repairable
                      ? `Repair hidden (${selectedRepairIssue.hidden})`
                      : 'Manual review required'}
                  </button>
                )}
                {selectedSession.provider === 'claude' && (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => setResourcesOpen(open => !open)}
                      className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium ${
                        resourcesOpen
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                      }`}
                    >
                      <PanelRightOpen size={13} />
                      Resources{resourceCount !== null ? ` (${resourceCount})` : ''}
                    </button>
                    <button
                      onClick={() => {
                        setMessageSelectMode(mode => !mode);
                        setSelectedMessages(new Set());
                      }}
                      className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium ${
                        messageSelectMode
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                      }`}
                    >
                      {messageSelectMode ? <CheckSquare size={13} /> : <Square size={13} />}
                      Messages
                    </button>
                    {messageSelectMode && selectedMessages.size > 0 && (
                      <button
                        onClick={handleDeleteMessages}
                        disabled={repairBusy}
                        className="flex items-center gap-1.5 rounded bg-red-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-60"
                      >
                        <Trash2 size={13} />
                        Delete ({selectedMessages.size})
                      </button>
                    )}
                  </div>
                )}
              </div>
              {selectedRepairIssue && (
                <div className="mt-2 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
                  <AlertTriangle size={13} />
                  <span>
                    {selectedRepairIssue.hidden} hidden assistant message(s), {selectedRepairIssue.roots} root tree(s)
                    {selectedRepairIssue.compactions > 0
                      ? `, ${selectedRepairIssue.compactions} compact boundary/boundaries`
                      : ''}
                    {selectedRepairIssue.repairBlockedReason
                      ? `. ${selectedRepairIssue.repairBlockedReason}`
                      : ''}
                  </span>
                </div>
              )}
              {mutationNotice && (
                <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs text-blue-700">
                  {mutationNotice}
                </div>
              )}
            </div>
            <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {loadingMsgs && (
                <p className="text-gray-400 text-sm text-center py-8">Loading…</p>
              )}
              {!loadingMsgs && messages.length === 0 && (
                <p className="text-gray-400 text-sm text-center py-8">No messages</p>
              )}
              {messages.map((msg, i) => {
                const isMessageSelected = Boolean(msg.id && selectedMessages.has(msg.id));
                return (
                <div
                  key={i}
                  onClick={() => {
                    if (messageSelectMode && msg.id) toggleMessageSelect(msg.id);
                  }}
                  className={`rounded-lg px-4 py-3 text-sm ${
                    msg.role === 'user'
                      ? 'bg-blue-50 border border-blue-100 text-gray-900'
                      : msg.role === 'assistant'
                      ? 'bg-white border border-gray-200 text-gray-800'
                      : msg.role === 'tool'
                      ? 'bg-gray-50 border border-gray-200 text-gray-500 font-mono text-xs'
                      : 'text-gray-400 text-xs italic'
                  } ${messageSelectMode ? 'cursor-pointer' : ''} ${
                    isMessageSelected ? 'ring-2 ring-blue-400' : ''
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      {messageSelectMode && msg.id && (
                        <span className="text-gray-400">
                          {isMessageSelected ? (
                            <CheckSquare size={14} className="text-blue-500" />
                          ) : (
                            <Square size={14} />
                          )}
                        </span>
                      )}
                      <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                        {msg.role}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-300">#{i + 1}</span>
                      {msg.timestamp > 0 && (
                        <span className="text-xs text-gray-400">{formatMsgTime(msg.timestamp)}</span>
                      )}
                    </div>
                  </div>
                  <MarkdownView content={msg.content} compact />
                </div>
              );
              })}
              <div ref={msgEndRef} />
            </div>
            {resourcesOpen && selectedSession.provider === 'claude' && (
              <SessionArtifactsPanel
                session={selectedSession}
                onClose={() => setResourcesOpen(false)}
              />
            )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            Select a session to view messages
          </div>
        )}
      </div>
    </div>
  );
}
