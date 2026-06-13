import { useState, useCallback } from 'react';
import { useVisibilityPolling } from '../hooks/useVisibilityPolling';
import { getUsage } from '../lib/api';
import { RefreshCw, AlertTriangle } from 'lucide-react';

interface UsageTier {
  name: string;
  label: string;
  utilization: number;
  resetAt: number;
}

interface ProviderUsage {
  provider: string;
  tiers: UsageTier[];
  error?: string;
  tokenExpired?: boolean;
}

function getBarColor(utilization: number): string {
  if (utilization >= 0.9) return 'bg-red-500';
  if (utilization >= 0.7) return 'bg-amber-500';
  return 'bg-green-500';
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
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <h3 className="text-sm font-medium text-zinc-300 mb-3">{providerLabel}</h3>

      {usage.tokenExpired && (
        <div className="flex items-center gap-2 text-amber-400 text-xs mb-3">
          <AlertTriangle size={14} />
          <span>OAuth token expired — re-login to {providerLabel} to refresh</span>
        </div>
      )}

      {usage.error && !usage.tokenExpired && (
        <div className="text-red-400 text-xs mb-3">Error: {usage.error}</div>
      )}

      {usage.tiers.length === 0 && !usage.error && !usage.tokenExpired && (
        <div className="text-zinc-500 text-xs">No usage data available</div>
      )}

      <div className="space-y-3">
        {usage.tiers.map(tier => (
          <div key={tier.name}>
            <div className="flex justify-between text-xs text-zinc-400 mb-1">
              <span>{tier.label}</span>
              <span>{(tier.utilization * 100).toFixed(1)}%</span>
            </div>
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${getBarColor(tier.utilization)}`}
                style={{ width: `${Math.min(tier.utilization * 100, 100)}%` }}
              />
            </div>
            {tier.resetAt > 0 && (
              <div className="text-[10px] text-zinc-600 mt-0.5">
                Resets in {formatCountdown(tier.resetAt)}
              </div>
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

  const fetchUsage = useCallback(async () => {
    try {
      const result = await getUsage();
      setData(result);
      setLastUpdated(Date.now());
    } catch {
      // Will retry on next interval
    }
  }, []);

  useVisibilityPolling(fetchUsage, 60_000);

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-medium text-zinc-200">Usage</h2>
        <div className="flex items-center gap-2">
          {lastUpdated > 0 && (
            <span className="text-xs text-zinc-600">
              Updated {new Date(lastUpdated).toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchUsage}
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            title="Refresh now"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      <div className="space-y-4">
        {data.length === 0 ? (
          <div className="text-zinc-500 text-sm">Loading usage data...</div>
        ) : (
          data.map(usage => <UsageCard key={usage.provider} usage={usage} />)
        )}
      </div>
    </div>
  );
}
