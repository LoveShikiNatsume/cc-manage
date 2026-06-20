import { NavLink } from 'react-router-dom';
import { MessageSquare, Brain, BarChart3, FolderTree, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { ClaudeDesktopSyncStatus } from '@shared/types';
import { getClaudeDesktopSyncStatus, runClaudeDesktopSync } from '../lib/api';

interface Props {
  children: ReactNode;
}

const tabs = [
  { to: '/sessions', label: 'Sessions', icon: MessageSquare },
  { to: '/memory', label: 'Memory', icon: Brain },
  { to: '/artifacts', label: 'Artifacts', icon: FolderTree },
  { to: '/usage', label: 'Usage', icon: BarChart3 },
];

function formatClock(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function syncLabel(status: ClaudeDesktopSyncStatus | null): string {
  if (!status) return 'Sync';
  if (!status.enabled) return 'Sync off';
  if (!status.environment?.available && !status.started) return 'Desktop sync inactive';
  if (status.running) return 'Syncing';
  if (status.pending && status.claudeRunning) return 'Waiting for Claude';
  if (status.pending) return 'Sync pending';
  if (status.lastSummary) {
    const at = formatClock(status.lastRunAt);
    const { written, archived, reconciled } = status.lastSummary;
    return `${at ? `Synced ${at}` : 'Synced'} · w${written} a${archived} r${reconciled}`;
  }
  return status.started ? 'Sync ready' : 'Sync';
}

export default function Layout({ children }: Props) {
  const [syncStatus, setSyncStatus] = useState<ClaudeDesktopSyncStatus | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);

  const refreshSyncStatus = useCallback(async () => {
    try {
      setSyncStatus(await getClaudeDesktopSyncStatus());
    } catch {
      setSyncStatus(null);
    }
  }, []);

  useEffect(() => {
    refreshSyncStatus();
    const timer = window.setInterval(refreshSyncStatus, 10000);
    return () => window.clearInterval(timer);
  }, [refreshSyncStatus]);

  const triggerSync = async () => {
    setSyncBusy(true);
    try {
      setSyncStatus(await runClaudeDesktopSync());
    } finally {
      setSyncBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900">
      {/* Header */}
      <header className="flex items-center gap-6 px-6 py-3 bg-white border-b border-gray-200 shrink-0">
        <span className="text-lg font-semibold tracking-tight text-gray-900">
          cc-manage
        </span>
        <nav className="flex gap-1">
          {tabs.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                }`
              }
            >
              <Icon size={15} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-xs text-gray-400">
          <span className="max-w-52 truncate" title={syncStatus?.lastError ?? syncLabel(syncStatus)}>
            {syncStatus?.lastError ? 'Sync error' : syncLabel(syncStatus)}
          </span>
          <button
            onClick={triggerSync}
            disabled={syncBusy || syncStatus?.running}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
            title="Run Claude Desktop sync"
          >
            <RefreshCw size={13} className={syncBusy || syncStatus?.running ? 'animate-spin' : ''} />
            Sync
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
