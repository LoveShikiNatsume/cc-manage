import { useCallback, useEffect, useState } from 'react';
import {
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Image,
  RefreshCw,
  X,
} from 'lucide-react';
import type {
  ClaudeArtifactContent,
  ClaudeArtifactItem,
  ClaudeSessionArtifacts,
  SessionMeta,
} from '@shared/types';
import { getClaudeArtifactContent, getSessionArtifacts } from '../lib/api';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ResourceIcon({ item }: { item: ClaudeArtifactItem }) {
  if (item.kind === 'subagent') return <Bot size={14} />;
  if (item.contentType === 'image') return <Image size={14} />;
  return <FileText size={14} />;
}

function ResourcePreview({ content }: { content: ClaudeArtifactContent }) {
  if (content.contentType === 'image' && content.encoding === 'base64' && content.content) {
    return (
      <div className="flex h-full items-start justify-center overflow-auto p-3">
        <img src={content.content} alt={content.name} className="max-w-full rounded border border-gray-200" />
      </div>
    );
  }

  if (content.encoding === 'utf-8' && content.content !== undefined) {
    return (
      <pre className="h-full overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed text-gray-700">
        {content.content}
      </pre>
    );
  }

  return <div className="p-4 text-center text-xs text-gray-400">Preview unavailable</div>;
}

export default function SessionArtifactsPanel({
  session,
  onClose,
}: {
  session: SessionMeta;
  onClose: () => void;
}) {
  const [overview, setOverview] = useState<ClaudeSessionArtifacts | null>(null);
  const [selected, setSelected] = useState<ClaudeArtifactItem | null>(null);
  const [content, setContent] = useState<ClaudeArtifactContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    new Set([
      'file-history',
      'session-env',
      'telemetry',
      'jobs',
      'shell-snapshots',
      'session-backups',
      'project-files',
    ]),
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await getSessionArtifacts(session.provider, session.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load session resources');
    } finally {
      setLoading(false);
    }
  }, [session.id, session.provider]);

  useEffect(() => {
    setSelected(null);
    setContent(null);
    void load();
  }, [load]);

  const openItem = async (item: ClaudeArtifactItem) => {
    setSelected(item);
    setContent(null);
    setLoading(true);
    setError(null);
    try {
      setContent(await getClaudeArtifactContent(item.path));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read resource');
    } finally {
      setLoading(false);
    }
  };

  const toggleGroup = (id: string) => {
    setCollapsed(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <aside className="flex w-96 shrink-0 flex-col overflow-hidden border-l border-gray-200 bg-white">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-gray-200 px-3">
        {selected ? (
          <button
            onClick={() => { setSelected(null); setContent(null); setError(null); }}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            title="Back to resources"
          >
            <ChevronLeft size={16} />
          </button>
        ) : (
          <span className="text-sm font-medium text-gray-800">
            Session resources{overview ? ` · ${overview.totalCount}` : ''}
          </span>
        )}
        {selected && <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">{selected.name}</span>}
        {!selected && <span className="flex-1" />}
        <button
          onClick={() => void load()}
          disabled={loading}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
          title="Refresh resources"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={onClose}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          title="Close resources"
        >
          <X size={15} />
        </button>
      </div>

      {error && (
        <div className="m-3 rounded border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {selected ? (
        <div className="min-h-0 flex-1">
          {loading && !content ? (
            <div className="p-6 text-center text-xs text-gray-400">Loading…</div>
          ) : content ? (
            <ResourcePreview content={content} />
          ) : null}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto py-1">
          {loading && !overview && <div className="p-6 text-center text-xs text-gray-400">Loading…</div>}
          {overview?.groups.map(group => (
            <section key={group.id}>
              <button
                onClick={() => toggleGroup(group.id)}
                className="flex w-full items-center border-b border-gray-100 px-3 py-2 text-left hover:bg-gray-50"
              >
                {collapsed.has(group.id)
                  ? <ChevronRight size={13} className="mr-1 text-gray-400" />
                  : <ChevronDown size={13} className="mr-1 text-gray-400" />}
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{group.label}</span>
                <span className="ml-auto text-xs text-gray-400">{group.totalCount}</span>
              </button>
              {!collapsed.has(group.id) && group.items.map(item => (
                <button
                  key={item.path}
                  onClick={() => void openItem(item)}
                  className="flex w-full items-start gap-2 border-b border-gray-50 px-3 py-2 text-left hover:bg-gray-50"
                >
                  <span className="mt-0.5 shrink-0 text-gray-400"><ResourceIcon item={item} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-gray-700">{item.name}</span>
                    <span className="block text-xs text-gray-400">{formatBytes(item.size)}</span>
                  </span>
                </button>
              ))}
            </section>
          ))}
          {overview && overview.totalCount === 0 && (
            <p className="p-6 text-center text-xs text-gray-400">No resources for this session</p>
          )}
        </div>
      )}
    </aside>
  );
}
