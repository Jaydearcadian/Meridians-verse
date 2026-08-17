'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { DashboardData, pollDashboardData } from '@/lib/api/dashboard'
import { mark, measure } from '@/lib/utils/performance'

/**
 * Configuration for dashboard data sync
 */
interface UseDashboardDataOptions {
  /** Initial data from server (SSR) */
  initialData?: DashboardData
  /** Polling interval in milliseconds (default: 10000 = 10s) */
  pollingInterval?: number
  /** Enable offline caching (default: true) */
  enableCache?: boolean
  /** Enable real-time polling (default: true) */
  enablePolling?: boolean
}

/**
 * Dashboard data state with metadata
 */
interface DashboardDataState {
  data: DashboardData | null
  isLoading: boolean
  isError: boolean
  isOffline: boolean
  lastUpdated: Date | null
  error: Error | null
}

const CACHE_KEY = 'meridians-dashboard-cache'
const CACHE_TIMESTAMP_KEY = 'meridians-dashboard-cache-timestamp'
const CACHE_TTL = 1000 * 60 * 60 // 1 hour

/**
 * Custom hook for dashboard data with real-time updates and offline support
 * 
 * Features:
 * - Real-time polling with configurable interval
 * - Offline detection and cached data fallback
 * - Automatic retry on error
 * - Zero layout shift (returns initialData immediately)
 * - localStorage caching for offline resilience
 * 
 * @example
 * ```tsx
 * const { data, isLoading, isOffline } = useDashboardData({
 *   initialData: serverData,
 *   pollingInterval: 10000,
 * })
 * ```
 */
export function useDashboardData(options: UseDashboardDataOptions = {}) {
  const {
    initialData,
    pollingInterval = 10000,
    enableCache = true,
    enablePolling = true,
  } = options

  const [state, setState] = useState<DashboardDataState>({
    data: initialData || null,
    isLoading: false,
    isError: false,
    isOffline: false,
    lastUpdated: initialData ? new Date(initialData.lastUpdated) : null,
    error: null,
  })

  const pollingIntervalRef = useRef<NodeJS.Timeout>()
  const isOnlineRef = useRef(true)

  /**
   * Load cached data from localStorage
   */
  const loadCachedData = useCallback((): DashboardData | null => {
    if (!enableCache || typeof window === 'undefined') return null

    try {
      const cachedData = localStorage.getItem(CACHE_KEY)
      const cacheTimestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY)

      if (!cachedData || !cacheTimestamp) return null

      const timestamp = parseInt(cacheTimestamp, 10)
      const now = Date.now()

      // Check if cache is still valid
      if (now - timestamp > CACHE_TTL) {
        localStorage.removeItem(CACHE_KEY)
        localStorage.removeItem(CACHE_TIMESTAMP_KEY)
        return null
      }

      return JSON.parse(cachedData) as DashboardData
    } catch (error) {
      console.error('Failed to load cached dashboard data:', error)
      return null
    }
  }, [enableCache])

  /**
   * Save data to localStorage cache
   */
  const saveCachedData = useCallback(
    (data: DashboardData) => {
      if (!enableCache || typeof window === 'undefined') return

      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(data))
        localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString())
      } catch (error) {
        console.error('Failed to cache dashboard data:', error)
      }
    },
    [enableCache]
  )

  /**
   * Fetch fresh data from API
   */
  const fetchData = useCallback(async () => {
    try {
      setState(prev => ({ ...prev, isLoading: true, isError: false }))

      // Performance tracking: mark fetch start
      mark('dashboard-data-fetch-start')

      const freshData = await pollDashboardData()

      // Performance tracking: mark fetch end and measure
      mark('dashboard-data-fetch-end')
      const fetchDuration = measure(
        'dashboard-data-fetch',
        'dashboard-data-fetch-start',
        'dashboard-data-fetch-end'
      )

      // Log performance in development
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Dashboard] Data fetch completed in ${fetchDuration.toFixed(2)}ms`)
      }

      // Report to analytics in production
      if (process.env.NODE_ENV === 'production' && typeof window !== 'undefined') {
        if ((window as any).gtag) {
          (window as any).gtag('event', 'dashboard_data_fetch', {
            value: Math.round(fetchDuration),
            event_category: 'Dashboard Performance',
            event_label: 'Data Fetch Duration',
            non_interaction: true,
          })
        }
      }

      setState(prev => ({
        ...prev,
        data: freshData,
        isLoading: false,
        isOffline: false,
        lastUpdated: new Date(freshData.lastUpdated),
        error: null,
      }))

      // Cache the fresh data
      saveCachedData(freshData)
    } catch (error) {
      console.error('Dashboard data fetch error:', error)

      // Try to load cached data on error
      const cachedData = loadCachedData()

      setState(prev => ({
        ...prev,
        data: cachedData || prev.data,
        isLoading: false,
        isError: true,
        isOffline: !navigator.onLine,
        error: error instanceof Error ? error : new Error('Failed to fetch data'),
      }))
    }
  }, [loadCachedData, saveCachedData])

  /**
   * Handle online/offline events
   */
  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleOnline = () => {
      isOnlineRef.current = true
      setState(prev => ({ ...prev, isOffline: false }))
      // Immediately fetch fresh data when coming back online
      fetchData()
    }

    const handleOffline = () => {
      isOnlineRef.current = false
      const cachedData = loadCachedData()
      
      setState(prev => ({
        ...prev,
        isOffline: true,
        data: cachedData || prev.data,
      }))
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // Check initial online status
    if (!navigator.onLine) {
      handleOffline()
    }

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [fetchData, loadCachedData])

  /**
   * Set up polling interval
   */
  useEffect(() => {
    if (!enablePolling || state.isOffline) return

    // Initial fetch if no data
    if (!state.data) {
      fetchData()
    }

    // Set up polling
    pollingIntervalRef.current = setInterval(() => {
      if (isOnlineRef.current) {
        fetchData()
      }
    }, pollingInterval)

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
      }
    }
  }, [enablePolling, pollingInterval, state.isOffline, state.data, fetchData])

  /**
   * Manual refresh function
   */
  const refresh = useCallback(() => {
    if (!state.isOffline) {
      fetchData()
    }
  }, [fetchData, state.isOffline])

  return {
    data: state.data,
    isLoading: state.isLoading,
    isError: state.isError,
    isOffline: state.isOffline,
    lastUpdated: state.lastUpdated,
    error: state.error,
    refresh,
  }
}
