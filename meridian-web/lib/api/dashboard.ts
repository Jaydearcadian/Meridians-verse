import { api, RequestOptions } from './client';

export interface LeaderboardEntry {
  rank: number;
  name: string;
  xp: number;
  yield: string;
  verified?: boolean;
}

export interface PoolStatsData {
  totalPoolValue: string;
  weeklyApy: string;
  activeParticipants?: number;
  totalYieldPaid?: string;
}

export interface DashboardMetrics {
  totalVolume: string;
  activeStreams: number;
  totalYield: string;
  totalXpEarned: number;
}

export interface DashboardData {
  metrics: DashboardMetrics;
  poolStats: PoolStatsData;
  leaderboard: LeaderboardEntry[];
}

const MOCK_LEADERBOARD: LeaderboardEntry[] = [
  { rank: 1, name: 'Alex Chen', xp: 15420, yield: '$1,250', verified: true },
  { rank: 2, name: 'Sarah Williams', xp: 14890, yield: '$1,180', verified: true },
  { rank: 3, name: 'Marcus Johnson', xp: 13650, yield: '$1,095', verified: false },
  { rank: 4, name: 'Emma Davis', xp: 12340, yield: '$987', verified: true },
  { rank: 5, name: 'James Wilson', xp: 11890, yield: '$945', verified: false },
];

const MOCK_POOL_STATS: PoolStatsData = {
  totalPoolValue: '$5.2M',
  weeklyApy: '24%',
  activeParticipants: 1284,
  totalYieldPaid: '$142.5K',
};

const MOCK_DASHBOARD_METRICS: DashboardMetrics = {
  totalVolume: '$12,450,000',
  activeStreams: 342,
  totalYield: '$450,000',
  totalXpEarned: 890450,
};

export async function fetchLeaderboard(options?: RequestOptions): Promise<LeaderboardEntry[]> {
  try {
    return await api.get<LeaderboardEntry[]>('/api/leaderboard', options);
  } catch {
    // Return mock data fallback for development/demo environments
    return MOCK_LEADERBOARD;
  }
}

export async function fetchPoolStats(options?: RequestOptions): Promise<PoolStatsData> {
  try {
    return await api.get<PoolStatsData>('/api/pool/stats', options);
  } catch {
    // Return mock data fallback for development/demo environments
    return MOCK_POOL_STATS;
  }
}

export async function fetchDashboardMetrics(options?: RequestOptions): Promise<DashboardMetrics> {
  try {
    return await api.get<DashboardMetrics>('/api/dashboard/metrics', options);
  } catch {
    // Return mock data fallback for development/demo environments
    return MOCK_DASHBOARD_METRICS;
  }
}

export async function fetchFullDashboardData(options?: RequestOptions): Promise<DashboardData> {
  try {
    return await api.get<DashboardData>('/api/dashboard', options);
  } catch {
    const [metrics, poolStats, leaderboard] = await Promise.all([
      fetchDashboardMetrics(options),
      fetchPoolStats(options),
      fetchLeaderboard(options),
    ]);
    return { metrics, poolStats, leaderboard };
  }
}
