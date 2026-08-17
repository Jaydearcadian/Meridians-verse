import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchFullDashboardData, DashboardData } from '@/lib/api/dashboard';
import { measureApiCall } from '@/lib/utils/performance';
import { ApiError } from '@/lib/api/client';

export interface UseDashboardDataOptions {
  initialData?: DashboardData | null;
  autoFetch?: boolean;
}

export interface UseDashboardDataResult {
  data: DashboardData | null;
  isLoading: boolean;
  error: ApiError | Error | null;
  refetch: () => Promise<void>;
}

export function useDashboardData(options: UseDashboardDataOptions = {}): UseDashboardDataResult {
  const { initialData = null, autoFetch = true } = options;

  const [data, setData] = useState<DashboardData | null>(initialData);
  const [isLoading, setIsLoading] = useState<boolean>(!initialData && autoFetch);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const loadDashboardData = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      const result = await measureApiCall('fetchFullDashboardData', () =>
        fetchFullDashboardData({ signal: controller.signal })
      );
      setData(result);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setError(err instanceof Error ? err : new Error('Failed to fetch dashboard data'));
    } finally {
      if (abortControllerRef.current === controller) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (autoFetch && !initialData) {
      loadDashboardData();
    }

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [autoFetch, initialData, loadDashboardData]);

  return {
    data,
    isLoading,
    error,
    refetch: loadDashboardData,
  };
}
