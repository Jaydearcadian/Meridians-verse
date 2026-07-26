'use client'

import { useEffect } from 'react'
import { monitorPerformance } from '@/lib/utils/performance'

/**
 * Performance Monitor Component
 * 
 * Client component that automatically monitors and reports Core Web Vitals
 * when mounted. Should be included once at the root layout level.
 * 
 * Monitors:
 * - Cumulative Layout Shift (CLS)
 * - Largest Contentful Paint (LCP)
 * - First Input Delay (FID)
 * - Time to First Byte (TTFB)
 * - First Contentful Paint (FCP)
 * 
 * In production, reports to analytics (Google Analytics via gtag)
 * In development, logs to console
 */
export function PerformanceMonitor() {
  useEffect(() => {
    // Only run in browser
    if (typeof window === 'undefined') return

    // Small delay to avoid impacting initial render
    const timeoutId = setTimeout(() => {
      monitorPerformance()
    }, 1000)

    return () => clearTimeout(timeoutId)
  }, [])

  // This component renders nothing
  return null
}
