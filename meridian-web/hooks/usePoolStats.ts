import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchPoolStats, PoolStatsData } from '@/lib/api/dashboard';
import { measureApiCall } from '@/lib/utils/performance';
import { ApiError } from '@/lib/api/client';

export interface UsePoolStatsOptions {
  autoFetch?: boolean;
}

export interface UsePoolStatsResult {
  stats: PoolStatsData | null;
  isLoading: boolean;
  error: ApiError | Error | null;
  refetch: () => Promise<void>;
}

export function usePoolStats(options: UsePoolStatsOptions = {}): UsePoolStatsResult {
  const { autoFetch = true } = options;
  const [stats, setStats] = useState<PoolStatsData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(autoFetch);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const loadPoolStats = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      const data = await measureApiCall('fetchPoolStats', () =>
        fetchPoolStats({ signal: controller.signal })
      );
      setStats(data);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setError(err instanceof Error ? err : new Error('Failed to fetch pool stats'));
    } finally {
      if (abortControllerRef.current === controller) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (autoFetch) {
      loadPoolStats();
    }

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [autoFetch, loadPoolStats]);

  return {
    stats,
    isLoading,
    error,
    refetch: loadPoolStats,
  };
}
