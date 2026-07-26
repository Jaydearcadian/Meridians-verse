'use client'

import { useEffect } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

/**
 * Dashboard Error Boundary
 * 
 * Catches errors in dashboard rendering and provides recovery options.
 * Maintains layout structure even in error state.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log error to error reporting service
    console.error('Dashboard error:', error)
  }, [error])

  return (
    <div className="container mx-auto py-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-2">
            Real-time metrics and productivity insights
          </p>
        </div>
      </div>

      <Card className="border-destructive">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <CardTitle>Failed to Load Dashboard</CardTitle>
          </div>
          <CardDescription>
            An error occurred while loading the dashboard data.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error.message && (
            <div className="rounded-lg bg-muted p-3">
              <p className="text-sm font-mono text-muted-foreground">
                {error.message}
              </p>
            </div>
          )}
          
          <div className="flex gap-2">
            <Button onClick={reset} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Try Again
            </Button>
            <Button
              variant="outline"
              onClick={() => window.location.reload()}
            >
              Reload Page
            </Button>
          </div>

          <div className="text-sm text-muted-foreground">
            <p>If the problem persists:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Check your internet connection</li>
              <li>Clear your browser cache</li>
              <li>Contact support if the issue continues</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
