import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchLeaderboard, LeaderboardEntry } from '@/lib/api/dashboard';
import { measureApiCall } from '@/lib/utils/performance';
import { ApiError } from '@/lib/api/client';

export interface UseLeaderboardOptions {
  limit?: number;
  autoFetch?: boolean;
}

export interface UseLeaderboardResult {
  leaderboard: LeaderboardEntry[];
  isLoading: boolean;
  error: ApiError | Error | null;
  refetch: () => Promise<void>;
}

export function useLeaderboard(options: UseLeaderboardOptions = {}): UseLeaderboardResult {
  const { limit, autoFetch = true } = options;
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(autoFetch);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const loadLeaderboard = useCallback(async () => {
    // Cancel any previous pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      const data = await measureApiCall('fetchLeaderboard', () =>
        fetchLeaderboard({
          signal: controller.signal,
          params: limit ? { limit } : undefined,
        })
      );
      setLeaderboard(data);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Request was cancelled; ignore error
        return;
      }
      setError(err instanceof Error ? err : new Error('Failed to fetch leaderboard'));
    } finally {
      if (abortControllerRef.current === controller) {
        setIsLoading(false);
      }
    }
  }, [limit]);

  useEffect(() => {
    if (autoFetch) {
      loadLeaderboard();
    }

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [autoFetch, loadLeaderboard]);

  return {
    leaderboard,
    isLoading,
    error,
    refetch: loadLeaderboard,
  };
}
