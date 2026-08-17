'use client';

import { motion } from 'framer-motion';
import { itemVariants } from '@/lib/animations/variants';
import { usePoolStats } from '@/hooks/usePoolStats';
import { Skeleton } from '@/components/ui/skeleton';

export function PoolStats() {
  const { stats, isLoading } = usePoolStats();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 pt-4">
        <div className="bg-card border border-border rounded-lg p-4 space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-20" />
        </div>
        <div className="bg-card border border-border rounded-lg p-4 space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-16" />
        </div>
      </div>
    );
  }

  return (
    <motion.div variants={itemVariants} className="grid grid-cols-2 gap-4 pt-4">
      <div className="bg-card border border-border rounded-lg p-4">
        <p className="text-sm text-muted-foreground mb-2">Total Pool Value</p>
        <p className="text-2xl font-bold text-primary">{stats?.totalPoolValue || '$5.2M'}</p>
      </div>
      <div className="bg-card border border-border rounded-lg p-4">
        <p className="text-sm text-muted-foreground mb-2">Weekly APY</p>
        <p className="text-2xl font-bold text-primary">{stats?.weeklyApy || '24%'}</p>
      </div>
    </motion.div>
  );
}
