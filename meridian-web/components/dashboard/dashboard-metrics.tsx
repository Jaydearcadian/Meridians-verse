'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { DollarSign, Zap, Award, TrendingUp, AlertTriangle, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DashboardMetrics as MetricsType } from '@/lib/api/dashboard';
import { ApiError } from '@/lib/api/client';

export interface DashboardMetricsProps {
  metrics?: MetricsType | null;
  isLoading?: boolean;
  error?: ApiError | Error | null;
  onRetry?: () => void;
}

export function DashboardMetrics({
  metrics,
  isLoading,
  error,
  onRetry,
}: DashboardMetricsProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-5 rounded-full" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-28 mb-1" />
              <Skeleton className="h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    const errorMessage =
      error instanceof ApiError
        ? `[${error.code || error.status}] ${error.message}`
        : error.message || 'An error occurred while loading metrics.';

    return (
      <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="text-destructive h-6 w-6 shrink-0" />
          <div>
            <h4 className="font-semibold text-foreground">Failed to load dashboard metrics</h4>
            <p className="text-sm text-muted-foreground">{errorMessage}</p>
          </div>
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} className="gap-2 shrink-0">
            <RefreshCw size={14} />
            Retry Request
          </Button>
        )}
      </div>
    );
  }

  if (!metrics) {
    return null;
  }

  const items = [
    {
      title: 'Total Volume',
      value: metrics.totalVolume,
      description: 'Lifetime volume streamed',
      icon: DollarSign,
      color: 'text-primary',
    },
    {
      title: 'Active Streams',
      value: metrics.activeStreams.toLocaleString(),
      description: 'Current real-time streams',
      icon: Zap,
      color: 'text-amber-500',
    },
    {
      title: 'Total Yield',
      value: metrics.totalYield,
      description: 'Distributed in prize pools',
      icon: TrendingUp,
      color: 'text-emerald-500',
    },
    {
      title: 'Total XP Earned',
      value: metrics.totalXpEarned.toLocaleString(),
      description: 'Earned via focus sessions',
      icon: Award,
      color: 'text-indigo-500',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <motion.div
            key={item.title}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.05 }}
          >
            <Card className="bg-card border-border hover:border-primary/30 transition-colors">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {item.title}
                </CardTitle>
                <Icon className={`h-5 w-5 ${item.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-foreground">{item.value}</div>
                <p className="text-xs text-muted-foreground mt-1">{item.description}</p>
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}
