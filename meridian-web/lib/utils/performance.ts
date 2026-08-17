export interface ApiPerformanceMetric {
  name: string;
  durationMs: number;
  timestamp: number;
  success: boolean;
}

const metricsLog: ApiPerformanceMetric[] = [];

/**
 * Wraps an API request promise to measure and log execution duration.
 */
export async function measureApiCall<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let success = true;

  try {
    const result = await fn();
    return result;
  } catch (error) {
    success = false;
    throw error;
  } finally {
    const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const durationMs = Math.round((endTime - startTime) * 100) / 100;
    
    const metric: ApiPerformanceMetric = {
      name,
      durationMs,
      timestamp: Date.now(),
      success,
    };

    metricsLog.push(metric);
    if (process.env.NODE_ENV === 'development') {
      console.log(`[API Performance] ${name}: ${durationMs}ms (Success: ${success})`);
    }
  }
}

export function getApiPerformanceMetrics(): ApiPerformanceMetric[] {
  return [...metricsLog];
}

export function clearApiPerformanceMetrics(): void {
  metricsLog.length = 0;
}
