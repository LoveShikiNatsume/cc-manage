import { useEffect, useState, useRef, useCallback } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Trash2,
  Search,
  X,
  CheckSquare,
  Square,
} from 'lucide-react';
import type { ProviderGroup, SessionMeta, SessionMessage } from '@shared/types';
import {
  getSessions,
  getMessages,
  deleteSession,
  batchDeleteSessions,
  renameSession,
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
  const renameRef = useRef<HTMLInputElement>(null);
  const msgEndRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await getSessions();
      setGroups(data);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (renaming) renameRef.current?.focus();
  }, [renaming]);

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const openSession = async (session: SessionMeta) => {
    if (selectMode) return;
    setSelectedSession(session);
    setMessages([]);
    setLoadingMsgs(true);
    try {
      const msgs = await getMessages(session.provider, session.id);
      setMessages(msgs);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingMsgs(false);
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
    if (session.provider !== 'claude') return;
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

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel */}
      <div className="w-80 shrink-0 flex flex-col bg-zinc-900 border-r border-zinc-800 overflow-hidden">
        {/* Toolbar */}
        <div className="p-3 border-b border-zinc-800 space-y-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search sessions…"
              className="w-full bg-zinc-800 text-zinc-100 text-sm rounded-md pl-8 pr-3 py-1.5 outline-none focus:ring-1 focus:ring-zinc-600 placeholder:text-zinc-500"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                <X size={13} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setSelectMode(m => !m); setSelected(new Set()); }}
              className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors ${selectMode ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'}`}
            >
              {selectMode ? <CheckSquare size={13} /> : <Square size={13} />}
              Select
            </button>
            {selectMode && selected.size > 0 && (
              <button
                onClick={handleBatchDelete}
                className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white transition-colors"
              >
                <Trash2 size={13} />
                Delete ({selected.size})
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
                  className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors"
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
                        className="w-full flex items-center gap-1.5 pl-6 pr-3 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40 transition-colors"
                      >
                        {isProjCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                        <span className="truncate">{project.name || '(root)'}</span>
                        <span className="ml-auto text-zinc-600">{project.sessions.length}</span>
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
                                ? 'bg-blue-600/20 text-zinc-100'
                                : isSelected
                                ? 'bg-zinc-700 text-zinc-100'
                                : 'text-zinc-300 hover:bg-zinc-800'
                            }`}
                          >
                            {selectMode && (
                              <div className="mt-0.5 shrink-0 text-zinc-400">
                                {isSelected ? <CheckSquare size={13} className="text-blue-400" /> : <Square size={13} />}
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
                                  className="w-full bg-zinc-700 text-zinc-100 text-xs rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-blue-500"
                                />
                              ) : (
                                <span className="text-xs truncate block">{session.title}</span>
                              )}
                              <span className="text-xs text-zinc-500">{formatTime(session.lastActivity)}</span>
                            </div>
                            {!selectMode && hoveredId === session.id && (
                              <button
                                onClick={e => handleDelete(e, session)}
                                className="shrink-0 p-0.5 text-zinc-500 hover:text-red-400 transition-colors"
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
            <p className="px-4 py-8 text-sm text-zinc-500 text-center">No sessions found</p>
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950">
        {selectedSession ? (
          <>
            <div className="px-5 py-3 border-b border-zinc-800 shrink-0">
              <h2 className="text-sm font-medium text-zinc-100 truncate">{selectedSession.title}</h2>
              <p className="text-xs text-zinc-500 truncate">{selectedSession.cwd}</p>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {loadingMsgs && (
                <p className="text-zinc-500 text-sm text-center py-8">Loading…</p>
              )}
              {!loadingMsgs && messages.length === 0 && (
                <p className="text-zinc-500 text-sm text-center py-8">No messages</p>
              )}
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`rounded-lg px-4 py-3 text-sm ${
                    msg.role === 'user'
                      ? 'bg-blue-950/50 border border-blue-900/40 text-zinc-100'
                      : msg.role === 'assistant'
                      ? 'bg-zinc-900 border border-zinc-800 text-zinc-200'
                      : msg.role === 'tool'
                      ? 'bg-zinc-900/50 border border-zinc-800/50 text-zinc-400 font-mono text-xs'
                      : 'text-zinc-500 text-xs italic'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                      {msg.role}
                    </span>
                    {msg.timestamp > 0 && (
                      <span className="text-xs text-zinc-600">{formatMsgTime(msg.timestamp)}</span>
                    )}
                  </div>
                  <pre className="whitespace-pre-wrap break-words font-sans">{msg.content}</pre>
                </div>
              ))}
              <div ref={msgEndRef} />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">
            Select a session to view messages
          </div>
        )}
      </div>
    </div>
  );
}
