import { useState, useCallback } from 'react';
import { useVisibilityPolling } from '../hooks/useVisibilityPolling';
import { getProviderUsage } from '../lib/api';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import type { ProviderUsage } from '@shared/types';

function getBarColor(utilization: number): string {
  if (utilization >= 0.9) return 'bg-red-500';
  if (utilization >= 0.7) return 'bg-amber-500';
  return 'bg-blue-500';
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
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-medium text-gray-700">{providerLabel}</h3>
          {usage.extra?.planType && (
            <p className="text-xs text-gray-400">Plan: {usage.extra.planType}</p>
          )}
        </div>
        {usage.source && (
          <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-500">
            {usage.source}
          </span>
        )}
      </div>

      {usage.tokenExpired && (
        <div className="flex items-center gap-2 text-amber-600 text-xs mb-3">
          <AlertTriangle size={14} />
          <span>{providerLabel} is signed out — login is required</span>
        </div>
      )}

      {usage.error && !usage.tokenExpired && (
        <div className="text-red-500 text-xs mb-3">Error: {usage.error}</div>
      )}

      {typeof usage.extra?.cachedAt === 'number' && (
        <div className="mb-3 text-xs text-amber-600">
          Showing cached data from {new Date(usage.extra.cachedAt).toLocaleTimeString()}
        </div>
      )}

      {usage.tiers.length === 0 && !usage.error && !usage.tokenExpired && (
        <div className="text-gray-400 text-xs">No usage data available</div>
      )}

      <div className="space-y-3">
        {usage.tiers.map(tier => (
          <div key={tier.name}>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>{tier.label}</span>
              <span>{(tier.utilization * 100).toFixed(1)}%</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${getBarColor(tier.utilization)}`}
                style={{ width: `${Math.min(tier.utilization * 100, 100)}%` }}
              />
            </div>
            {tier.resetAt > 0 && (
              <div className="text-[10px] text-gray-400 mt-0.5">
                Resets in {formatCountdown(tier.resetAt)}
              </div>
            )}
            {tier.detail && (
              <div className="text-[10px] text-gray-400 mt-0.5">{tier.detail}</div>
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
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    setRequestError(null);
    const results = await Promise.allSettled(
      (['claude', 'codex'] as const).map(async provider => {
        const usage = await getProviderUsage(provider);
        setData(current => {
          const next = current.filter(item => item.provider !== provider);
          next.push(usage);
          return next.sort((a, b) => a.provider.localeCompare(b.provider));
        });
        return usage;
      }),
    );
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length < results.length) {
      setLastUpdated(Date.now());
    }
    if (failures.length > 0) {
      setRequestError(
        failures.length === results.length
          ? 'Unable to load usage data. Check the server connection and try again.'
          : 'One provider could not be refreshed; available usage is shown below.',
      );
    }
    setLoading(false);
  }, []);

  useVisibilityPolling(fetchUsage, 60_000);

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-medium text-gray-800">Usage</h2>
        <div className="flex items-center gap-2">
          {lastUpdated > 0 && (
            <span className="text-xs text-gray-400">
              Updated {new Date(lastUpdated).toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchUsage}
            disabled={loading}
            className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"
            title="Refresh now"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      {requestError && (
        <div className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {requestError}
        </div>
      )}
      <div className="space-y-4">
        {data.length === 0 ? (
          <div className="text-gray-400 text-sm">
            {loading ? 'Loading usage data...' : 'No usage data available'}
          </div>
        ) : (
          data.map(usage => <UsageCard key={usage.provider} usage={usage} />)
        )}
      </div>
    </div>
  );
}
